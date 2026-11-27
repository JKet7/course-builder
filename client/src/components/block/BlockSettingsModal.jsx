import { useId, useRef, useState } from 'react';
import { useBlockStore } from '../../store/blockStore.js';
import { IMAGE_MIME_TYPES, uploadImage } from '../../api/files.js';
import { BLOCK_TYPES, getBlockContentLabel, getBlockIcon, getBlockTypeLabel } from '../../utils/helpers.js';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../ui/ConfirmModal.jsx';
import Icon from '../ui/Icon.jsx';
import { Input, Textarea } from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const COVER_MAX = 500;

const TYPE_HINTS = {
  theory: 'Слайды: текст, картинки, видео, таблицы',
  test: 'Вопросы: один/несколько ответов, соответствие, карточки',
  memo: 'Слайды-памятки для повторения',
  glossary: 'Термины и определения с поиском',
};

// Те же ограничения, что в server/src/routes/blockRoutes.js
function validateBlock(values) {
  const errors = {};
  const title = values.title.trim();
  const cover = values.coverImage.trim();

  if (!BLOCK_TYPES.includes(values.type)) errors.type = 'Тип: выберите тип блока';

  if (!title) errors.title = 'Название: обязательное поле';
  else if (title.length > TITLE_MAX) errors.title = `Название: не длиннее ${TITLE_MAX} символов`;

  if (values.description.length > DESCRIPTION_MAX) {
    errors.description = `Описание: не длиннее ${DESCRIPTION_MAX} символов`;
  }

  if (cover.length > COVER_MAX) {
    errors.coverImage = `Обложка: не длиннее ${COVER_MAX} символов`;
  } else if (cover && !/^(https?:\/\/|\/)/i.test(cover)) {
    errors.coverImage = 'Обложка: нужна ссылка http(s):// или путь от корня сайта';
  }

  return errors;
}

/** Выбор типа блока — четыре плитки вместо выпадающего списка. */
function TypePicker({ value, onChange, disabled, error }) {
  return (
    <div className="field">
      <span className="field__label" id="block-type-label">
        Тип блока
      </span>

      <div className="type-picker" role="radiogroup" aria-labelledby="block-type-label">
        {BLOCK_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={value === type}
            className={['type-picker__option', value === type ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => !disabled && onChange(type)}
            disabled={disabled}
          >
            <Icon name={getBlockIcon(type)} size={18} />
            <span className="type-picker__name">{getBlockTypeLabel(type)}</span>
            <span className="type-picker__hint">{TYPE_HINTS[type]}</span>
          </button>
        ))}
      </div>

      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}

/**
 * Обложка блока: файл (выбор, drag&drop, вставка из буфера) или ссылка.
 * Файл сразу загружается в /api/files, в форму попадает его адрес.
 */
function CoverField({ value, onChange, error }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file) => {
    if (!file || uploading) return;

    setUploading(true);
    setUploadError(null);

    const result = await uploadImage(file);
    setUploading(false);

    if (!result.ok) {
      setUploadError(result.message);
      return;
    }

    onChange(result.file.url);
  };

  /** Вставка картинки из буфера обмена (Ctrl+V на области). */
  const handlePaste = (event) => {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
    if (!item) return;

    const file = item.getAsFile();
    if (!file) return;

    event.preventDefault();
    handleFile(file);
  };

  return (
    <div className="field">
      <span className="field__label">Фоновая картинка (путь или URL)</span>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_MIME_TYPES.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <div
        className={['cover-field', dragging ? 'is-dragging' : '', value ? 'has-image' : ''].filter(Boolean).join(' ')}
        tabIndex={0}
        onPaste={handlePaste}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFile(event.dataTransfer?.files?.[0]);
        }}
      >
        {value ? <img className="cover-field__image" src={value} alt="" /> : null}

        <div className="cover-field__row">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Icon name={uploading ? 'loader' : 'upload'} size={14} className={uploading ? 'icon--spin' : undefined} />
            {uploading ? 'Загружаем…' : value ? 'Заменить файл' : 'Выбрать файл'}
          </button>

          {value ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange('')} disabled={uploading}>
              <Icon name="trash" size={14} />
              Убрать
            </button>
          ) : null}
        </div>

        <span className="field__hint">
          Перетащите файл сюда или вставьте картинку из буфера (Ctrl+V). PNG, JPEG, WebP, GIF — до 5 МБ.
        </span>
      </div>

      <input
        className={error ? 'input input--invalid' : 'input'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={COVER_MAX}
        placeholder="images/cover.png или https://…"
        aria-label="Ссылка на обложку"
      />

      {uploadError && <span className="field__error">{uploadError}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

/**
 * Создание и настройка блока.
 * courseId — обязателен при создании, block — при редактировании.
 */
export default function BlockSettingsModal({ courseId, block = null, onClose }) {
  const isEdit = Boolean(block?.id);
  const formId = useId();

  const addBlock = useBlockStore((state) => state.addBlock);
  const updateBlock = useBlockStore((state) => state.updateBlock);

  const [values, setValues] = useState({
    type: block?.type ?? 'theory',
    title: block?.title ?? '',
    description: block?.description ?? '',
    coverImage: block?.coverImage ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Тип можно менять, только пока внутри нет контента (то же правило на сервере)
  const typeLocked = isEdit && (block?.contentCount ?? 0) > 0;

  const handleChange = (name) => (event) => {
    const { value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    setFormError(null);
  };

  const handleTypeChange = (type) => {
    setValues((prev) => ({ ...prev, type }));
    setFieldErrors((prev) => (prev.type ? { ...prev, type: undefined } : prev));
    setFormError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const localErrors = validateBlock(values);
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const payload = {
      type: values.type,
      title: values.title.trim(),
      description: values.description.trim(),
      coverImage: values.coverImage.trim(),
    };

    setSubmitting(true);
    setFormError(null);

    const result = isEdit ? await updateBlock(block.id, payload) : await addBlock({ ...payload, courseId });
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
      title={isEdit ? 'Настройки блока' : 'Новый блок'}
      subtitle={
        isEdit
          ? 'Название, описание и обложку можно менять в любой момент'
          : 'Блок появится в конце курса'
      }
      size="lg"
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
            {isEdit ? 'Сохранить' : 'Создать блок'}
          </Button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
        <TypePicker
          value={values.type}
          onChange={handleTypeChange}
          disabled={typeLocked}
          error={fieldErrors.type}
        />

        {typeLocked && (
          <p className="field__hint">Тип нельзя изменить: внутри блока уже есть контент.</p>
        )}

        <Input
          label="Название"
          value={values.title}
          onChange={handleChange('title')}
          error={fieldErrors.title}
          maxLength={TITLE_MAX}
          placeholder="Например, Введение в технику безопасности"
          required
        />

        <Textarea
          label="Описание"
          rows={3}
          value={values.description}
          onChange={handleChange('description')}
          error={fieldErrors.description}
          hint={`${values.description.length} из ${DESCRIPTION_MAX} символов`}
          maxLength={DESCRIPTION_MAX}
          placeholder="Коротко о блоке (необязательно)"
        />

        <CoverField
          value={values.coverImage}
          onChange={(value) => {
            setValues((prev) => ({ ...prev, coverImage: value }));
            setFieldErrors((prev) => (prev.coverImage ? { ...prev, coverImage: undefined } : prev));
            setFormError(null);
          }}
          error={fieldErrors.coverImage}
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

/** Удаление блока с подтверждением (контент внутри удаляется каскадом). */
export function BlockDeleteModal({ block, onClose }) {
  const deleteBlock = useBlockStore((state) => state.deleteBlock);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    const result = await deleteBlock(block.id);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    onClose();
  };

  const contentCount = block.contentCount ?? 0;

  return (
    <ConfirmModal
      title="Удалить блок?"
      confirmLabel="Удалить блок"
      loading={submitting}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
      message={
        <>
          <p className="modal__text">
            Блок «{block.title}» будет удалён без возможности восстановления.
          </p>
          {contentCount > 0 && (
            <p className="modal__text modal__text--muted">
              Вместе с блоком удалится всё его содержимое:{' '}
              {contentCount} {getBlockContentLabel(block.type, contentCount)}.
            </p>
          )}
        </>
      }
    />
  );
}

