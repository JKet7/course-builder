import { useEffect, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import TiptapEditor from '../editor/TiptapEditor.jsx';
import QuestionSettingsPanel from './QuestionSettingsPanel.jsx';
import useAutoSave, { SAVE_STATUS_LABELS } from '../content/useAutoSave.js';
import { uploadImage } from '../../api/files.js';
import { getQuestionType, getQuestionTypeLabel, QUESTION_LIMITS } from '../../utils/helpers.js';
import { toDraft, toPayload, validateDraft } from '../../utils/testDraft.js';
import { sanitizeTargets, setOptionTarget } from '../../utils/testEditor.js';

const emptyOption = (isCorrect = false) => ({ text: '', isCorrect, targetType: 'next', targetSectionId: null });
const emptyPair = () => ({ left: '', right: '' });

/*
 * Карточка перетаскивается целиком, как фрагменты в «Теории» и карточки
 * в «Памятке»: отдельной ручки нет. Но поля ввода, кнопки и Tiptap —
 * не место для перетаскивания: dragstart из них отменяем, иначе нельзя
 * ни выделить текст, ни перетащить пару внутри вопроса.
 */
const DRAG_BLOCKERS = 'input, textarea, select, button, a, [contenteditable="true"], .question-settings';

/** Сторона карточки «Карточка»: текст и картинка (передняя или задняя). */
function CardSide({ label, text, image, placeholder, onChange, onError }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    const result = await uploadImage(file);
    setUploading(false);

    if (!result.ok) {
      onError?.(result.message);
      return;
    }

    onError?.(null);
    onChange({ image: result.file.url });
  };

  return (
    <div className="card-side">
      <div className="card-side__head">
        <span className="card-side__label">{label}</span>

        <span className="card-side__actions">
          <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" onChange={pickFile} />

          <Button variant="ghost" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={14} />
            {uploading ? 'Загружаем…' : image ? 'Заменить картинку' : 'Картинка'}
          </Button>

          {image && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ image: '' })}>
              <Icon name="x" size={14} />
              Убрать
            </Button>
          )}
        </span>
      </div>

      <textarea
        className="input"
        rows={2}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange({ text: event.target.value })}
      />

      {image && <img className="card-side__image" src={image} alt={label} />}
    </div>
  );
}

/** Строка варианта ответа: отметка верного (радио — один, чекбокс — несколько). */
function OptionRow({ option, index, type, onChange, onRemove }) {
  return (
    <li className="option-row">
      <label className="option-row__mark">
        <input
          type={type === 'single' ? 'radio' : 'checkbox'}
          checked={option.isCorrect}
          aria-label={`Вариант ${index + 1} верный`}
          onChange={(event) => onChange({ ...option, isCorrect: event.target.checked })}
        />
      </label>

      <input
        className="input input--sm"
        value={option.text}
        placeholder={`Вариант ${index + 1}`}
        onChange={(event) => onChange({ ...option, text: event.target.value })}
      />

      <button
        type="button"
        className="icon-btn icon-btn--danger"
        aria-label={`Удалить вариант ${index + 1}`}
        onClick={onRemove}
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}

/** Пара сопоставления: перетаскивается за ручку, порядок задаёт верный ответ. */
function PairRow({ pair, index, isDragging, onChange, onRemove, onDragStart, onDragEnd, onDrop }) {
  return (
    <li
      className={isDragging ? 'pair-row is-dragging' : 'pair-row'}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes('text/plain')) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="pair-row__grip"
        draggable
        aria-label={`Перетащить пару ${index + 1}`}
        title="Перетащите, чтобы изменить порядок пар"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <Icon name="grip" size={14} />
      </button>

      <input
        className="input input--sm"
        value={pair.left}
        placeholder="Понятие"
        aria-label={`Левая часть пары ${index + 1}`}
        onChange={(event) => onChange({ ...pair, left: event.target.value })}
      />

      <Icon name="chevronRight" size={14} className="pair-row__arrow" />

      <input
        className="input input--sm"
        value={pair.right}
        placeholder="Значение"
        aria-label={`Правая часть пары ${index + 1}`}
        onChange={(event) => onChange({ ...pair, right: event.target.value })}
      />

      <button
        type="button"
        className="icon-btn icon-btn--danger"
        aria-label={`Удалить пару ${index + 1}`}
        onClick={onRemove}
      >
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/**
 * Карточка вопроса в стиле Google Forms: всегда развёрнута, без слайдов.
 * Тип и группа меняются в правой панели, здесь — текст, варианты, пары,
 * стороны карточки и пояснение на розовом фоне. Изменения уходят
 * автосохранением (700 мс), только если черновик валиден.
 */
export default function QuestionCard({
  question,
  index,
  groups = [],
  sections = [],
  settings = {},
  active = false,
  linked = false,
  dragging = false,
  dropTarget = false,
  onActivate,
  onDeactivate,
  onSave,
  onDuplicate,
  onDelete,
  onSectionChange,
  onDragStart,
  onDragEnd,
}) {
  const [draft, setDraft] = useState(() => toDraft(question));
  const [error, setError] = useState(null);
  const [pairDrag, setPairDrag] = useState(null);

  const { status, queue } = useAutoSave((payload) => onSave(question.id, payload));

  // Панель настроек открывается только шестерёнкой, поэтому клик по карточке
  // больше ничего не делает. Закрываем панель кликом вне её и по Esc — как модалки.
  const deactivateRef = useRef(onDeactivate);
  useEffect(() => {
    deactivateRef.current = onDeactivate;
  });

  useEffect(() => {
    if (!active) return undefined;

    const handlePointerDown = (event) => {
      if (event.target.closest?.('.question-settings, [data-settings-toggle]')) return;
      deactivateRef.current?.();
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') deactivateRef.current?.();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active]);

  // Тянем карточку за любое свободное место; поля ввода, кнопки и Tiptap
  // перетаскивание не начинают (см. DRAG_BLOCKERS).
  const startCardDrag = (event) => {
    if (event.target.closest?.(DRAG_BLOCKERS)) {
      event.preventDefault();
      return;
    }

    onDragStart?.(event);
  };

  // Группу могли изменить на сервере (например, саму группу удалили).
  const prevGroup = useRef(question.groupId ?? null);
  useEffect(() => {
    const server = question.groupId ?? null;
    if (prevGroup.current === server) return;

    prevGroup.current = server;
    setDraft((current) => ({ ...current, groupId: server }));
  }, [question.groupId]);

  const apply = (patch) => {
    const next = { ...draft, ...patch };
    setDraft(next);

    const check = validateDraft(next);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    setError(null);
    queue(toPayload({ ...next, options: sanitizeTargets(next.options, sections) }));
  };

  const changeType = (type) => {
    if (type === draft.type) return;

    const patch = { type };

    if (type === 'card' && draft.type !== 'card') patch.front = draft.text;
    if (type !== 'card' && draft.type === 'card') patch.text = draft.front;

    if ((type === 'single' || type === 'multiple') && draft.options.length < 2) {
      patch.options = [emptyOption(true), emptyOption()];
    }

    if (type === 'match' && draft.pairs.every((pair) => !pair.left && !pair.right)) {
      patch.pairs = [emptyPair(), emptyPair()];
    }

    if (type === 'single') {
      const options = patch.options ?? draft.options;
      const correctIndex = Math.max(0, options.findIndex((option) => option.isCorrect));
      patch.options = options.map((option, optionIndex) => ({ ...option, isCorrect: optionIndex === correctIndex }));
    }

    apply(patch);
  };

  const addOption = () => {
    if (draft.options.length >= QUESTION_LIMITS.options) return;
    apply({ options: [...draft.options, emptyOption()] });
  };

  const removeOption = (optionIndex) => {
    if (draft.options.length <= 2) return;
    apply({ options: draft.options.filter((_, index) => index !== optionIndex) });
  };

  const changeOption = (optionIndex, value) => {
    const options = draft.options.map((item, index) => (index === optionIndex ? value : item));

    apply({
      options:
        draft.type === 'single' && value.isCorrect
          ? options.map((item, index) => ({ ...item, isCorrect: index === optionIndex }))
          : options,
    });
  };

  const addPair = () => {
    if (draft.pairs.length >= QUESTION_LIMITS.pairs) return;
    apply({ pairs: [...draft.pairs, emptyPair()] });
  };

  const removePair = (pairIndex) => {
    if (draft.pairs.length <= 2) return;
    apply({ pairs: draft.pairs.filter((_, index) => index !== pairIndex) });
  };

  const dropPair = (targetIndex) => (event) => {
    event.preventDefault();
    const source = Number.isInteger(pairDrag) ? pairDrag : Number(event.dataTransfer?.getData('text/plain'));
    setPairDrag(null);

    if (!Number.isInteger(source) || source === targetIndex) return;

    const pairs = [...draft.pairs];
    const [moved] = pairs.splice(source, 1);
    pairs.splice(targetIndex, 0, moved);
    apply({ pairs });
  };

  const meta = getQuestionType(draft.type);
  const cardClass = [
    'question-card',
    active ? 'is-active' : '',
    dragging ? 'is-dragging' : '',
    dropTarget ? 'is-drop-target' : '',
    linked ? 'is-link-target' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={cardClass}
      data-question-id={question.id}
      aria-label={`Вопрос ${index + 1}`}
      draggable
      onDragStart={startCardDrag}
      onDragEnd={onDragEnd}
    >
      <header className="question-card__head">
        <span className="question-card__index">{index + 1}</span>

        <span className="question-card__badge">
          <Icon name={meta.icon} size={14} />
          {getQuestionTypeLabel(draft.type)}
        </span>

        {question.group && <span className="question-card__group">{question.group.name}</span>}
        {question.section && <span className="question-card__group">{question.section.title}</span>}

        <span className="question-card__spacer" />

        <span className={`content-editor__status content-editor__status--${status}`} role="status">
          {SAVE_STATUS_LABELS[status]}
        </span>

        <button
          type="button"
          className={`icon-btn question-card__settings${active ? ' is-active' : ''}`}
          data-settings-toggle
          aria-label={`Настройки вопроса ${index + 1}`}
          aria-expanded={active}
          title="Настройки вопроса"
          onClick={(event) => {
            event.stopPropagation();
            if (active) onDeactivate?.();
            else onActivate?.();
          }}
        >
          <Icon name="settings" size={15} />
        </button>
      </header>

      <div className="question-card__body">
        {draft.type === 'card' ? (
          <div className="question-card__sides">
            <CardSide
              label="Передняя сторона"
              text={draft.front}
              image={draft.frontImage}
              placeholder="Понятие или вопрос"
              onError={setError}
              onChange={(patch) =>
                apply(patch.image !== undefined ? { frontImage: patch.image } : { front: patch.text })
              }
            />

            <CardSide
              label="Задняя сторона"
              text={draft.back}
              image={draft.backImage}
              placeholder="Ответ"
              onError={setError}
              onChange={(patch) =>
                apply(patch.image !== undefined ? { backImage: patch.image } : { back: patch.text })
              }
            />
          </div>
        ) : (
          <label className="content-field">
            <span className="content-field__label">Вопрос</span>
            <textarea
              className="input question-card__question"
              rows={2}
              value={draft.text}
              placeholder="Сформулируйте вопрос"
              onChange={(event) => apply({ text: event.target.value })}
            />
          </label>
        )}

        {(draft.type === 'single' || draft.type === 'multiple') && (
          <div className="content-field">
            <span className="content-field__label">
              Варианты ответа {draft.type === 'single' ? '(один верный)' : '(несколько верных)'}
            </span>

            <ul className="option-list">
              {draft.options.map((option, optionIndex) => (
                <OptionRow
                  key={optionIndex}
                  option={option}
                  index={optionIndex}
                  type={draft.type}
                  onChange={(value) => changeOption(optionIndex, value)}
                  onRemove={() => removeOption(optionIndex)}
                />
              ))}
            </ul>

            <div className="option-controls">
              <Button
                variant="ghost"
                size="sm"
                onClick={addOption}
                disabled={draft.options.length >= QUESTION_LIMITS.options}
              >
                <Icon name="plus" size={14} />
                Добавить вариант
              </Button>

              <span className="option-controls__count">
                {draft.options.length} из {QUESTION_LIMITS.options}
              </span>
            </div>
          </div>
        )}

        {draft.type === 'match' && (
          <div className="content-field">
            <span className="content-field__label">Пары для сопоставления — порядок задаёт правильный ответ</span>

            <ul className="pair-list">
              {draft.pairs.map((pair, pairIndex) => (
                <PairRow
                  key={pairIndex}
                  pair={pair}
                  index={pairIndex}
                  isDragging={pairDrag === pairIndex}
                  onChange={(value) =>
                    apply({ pairs: draft.pairs.map((item, index) => (index === pairIndex ? value : item)) })
                  }
                  onRemove={() => removePair(pairIndex)}
                  onDragStart={(event) => {
                    // Пары перетаскиваются внутри вопроса: событие не должно
                    // доходить до карточки, иначе она начнёт тянуться сама.
                    event.stopPropagation();
                    setPairDrag(pairIndex);
                    event.dataTransfer?.setData('text/plain', String(pairIndex));
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setPairDrag(null)}
                  onDrop={dropPair(pairIndex)}
                />
              ))}
            </ul>

            <div className="option-controls">
              <Button
                variant="ghost"
                size="sm"
                onClick={addPair}
                disabled={draft.pairs.length >= QUESTION_LIMITS.pairs}
              >
                <Icon name="plus" size={14} />
                Добавить пару
              </Button>

              <span className="option-controls__count">
                {draft.pairs.length} из {QUESTION_LIMITS.pairs}
              </span>
            </div>
          </div>
        )}

        {draft.type !== 'card' && (
          <div className="question-card__explanation">
            <span className="question-card__label">Объяснение</span>
            <div className="question-card__tiptap">
              <TiptapEditor
                value={draft.explanation}
                placeholder="Пояснение к ответу…"
                onChange={(doc) => apply({ explanation: doc })}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="content-field__error" role="alert">
            {error}
          </p>
        )}
      </div>

      {active && (
        <QuestionSettingsPanel
          question={question}
          draft={draft}
          groups={groups}
          sections={sections}
          settings={settings}
          onTypeChange={changeType}
          onGroupChange={(groupId) => apply({ groupId })}
          onSectionChange={onSectionChange}
          onTargetChange={(optionIndex, value) =>
            apply({ options: setOptionTarget(draft.options, optionIndex, value) })
          }
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onClose={onDeactivate}
        />
      )}
    </article>
  );
}


