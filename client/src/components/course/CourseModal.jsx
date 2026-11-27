import { useId, useState } from 'react';
import { useCourseStore } from '../../store/courseStore.js';
import { pluralize } from '../../utils/helpers.js';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../ui/ConfirmModal.jsx';
import Icon from '../ui/Icon.jsx';
import { Input, Textarea } from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;

// Те же ограничения, что в server/src/routes/courseRoutes.js
function validateCourse({ title, description }) {
  const errors = {};
  const cleanTitle = title.trim();

  if (!cleanTitle) errors.title = 'Название: обязательное поле';
  else if (cleanTitle.length > TITLE_MAX) errors.title = `Название: не длиннее ${TITLE_MAX} символов`;

  if (description.length > DESCRIPTION_MAX) errors.description = `Описание: не длиннее ${DESCRIPTION_MAX} символов`;

  return errors;
}

/**
 * Создание и редактирование курса.
 * course = null → создание, course = { id, title, description } → редактирование.
 */
export default function CourseModal({ course = null, onClose }) {
  const isEdit = Boolean(course?.id);
  const formId = useId();

  const addCourse = useCourseStore((state) => state.addCourse);
  const updateCourse = useCourseStore((state) => state.updateCourse);

  const [values, setValues] = useState({
    title: course?.title ?? '',
    description: course?.description ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (name) => (event) => {
    const { value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    // Правка поля снимает его ошибку (и серверную тоже)
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    setFormError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const localErrors = validateCourse(values);
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const payload = { title: values.title.trim(), description: values.description.trim() };
    setSubmitting(true);
    setFormError(null);

    const result = isEdit ? await updateCourse(course.id, payload) : await addCourse(payload);
    setSubmitting(false);

    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.message);
      return;
    }

    onClose();
  };

  return (
    <Modal
      title={isEdit ? 'Редактировать курс' : 'Новый курс'}
      subtitle={isEdit ? 'Название и описание видны на карточке курса' : 'Курс появится в конце списка'}
      onClose={submitting ? undefined : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form={formId} disabled={submitting}>
            {submitting ? (
              <Icon name="loader" size={16} className="icon--spin" />
            ) : (
              <Icon name="save" size={16} />
            )}
            {isEdit ? 'Сохранить' : 'Создать курс'}
          </Button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
        <Input
          label="Название"
          value={values.title}
          onChange={handleChange('title')}
          error={fieldErrors.title}
          maxLength={TITLE_MAX}
          placeholder="Например, Охрана труда"
          required
        />

        <Textarea
          label="Описание"
          rows={5}
          value={values.description}
          onChange={handleChange('description')}
          error={fieldErrors.description}
          hint={`${values.description.length} из ${DESCRIPTION_MAX} символов`}
          maxLength={DESCRIPTION_MAX}
          placeholder="Коротко о курсе (необязательно)"
        />

        {formError && (
          <div className="alert alert--error" role="alert">
            <Icon name="alert" size={18} />
            <span className="alert__text">{formError}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Удаление курса с подтверждением. */
export function CourseDeleteModal({ course, onClose }) {
  const deleteCourse = useCourseStore((state) => state.deleteCourse);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    const result = await deleteCourse(course.id);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    onClose();
  };

  const blocksCount = course.blocksCount ?? 0;

  return (
    <ConfirmModal
      title="Удалить курс?"
      confirmLabel="Удалить курс"
      loading={submitting}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
      message={
        <>
          <p className="modal__text">
            Курс «{course.title}» будет удалён без возможности восстановления.
          </p>
          {blocksCount > 0 && (
            <p className="modal__text modal__text--muted">
              Вместе с ним удалятся {blocksCount} {pluralize(blocksCount, ['блок', 'блока', 'блоков'])} и весь
              их контент.
            </p>
          )}
        </>
      }
    />
  );
}
