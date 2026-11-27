import { useRef, useState } from 'react';
import EditorField from './EditorField.jsx';
import RichInput from './RichInput.jsx';
import DialogView from '../DialogView.jsx';
import Icon from '../../ui/Icon.jsx';
import ToolbarButton from '../../editor/toolbar/ToolbarButton.jsx';
import { MAX_IMAGE_SIZE, IMAGE_MIME_TYPES, uploadImage } from '../../../api/files.js';
import {
  DIALOG_COLOR_FALLBACK,
  DIALOG_FOCUS_POINTS,
  DIALOG_LIMITS,
  DIALOG_POSITIONS,
  DIALOG_SIDES,
  DIALOG_TAILS,
  DIALOG_TEXT_ALIGNS,
  DIALOG_ZOOM_STEP,
  createDialogLine,
  dialogAvatarStyle,
  normalizeContentData,
  normalizeDialogFocus,
  normalizeDialogZoom,
} from '../../../utils/helpers.js';
import { collectPlainLinks } from '../../../utils/links.js';
import { collectPlainNotes, plainNoteNumbers } from '../../../utils/notes.js';

/** Горячие клавиши позиции реплики (Ctrl+Shift+L / E / R). */
const POSITION_HOTKEYS = { l: 'left', e: 'center', r: 'right' };
const HOTKEY_HINTS = { left: 'Ctrl+Shift+L', center: 'Ctrl+Shift+E', right: 'Ctrl+Shift+R' };

/**
 * Редактор диалога (бывшая «Реплика»): несколько реплик персонажей.
 *
 * У каждой реплики свои имя, аватар, сторона на слайде, место персонажа и текст;
 * оформление (размер аватара, цвета, рамка, радиус, хвостик, выравнивание)
 * настраивается для всего фрагмента. Внизу — предпросмотр, он же рендер слайда.
 * Примечания и ссылки живут в общих data.notes / data.links, у реплики
 * поле 'text' и ref = id реплики (см. utils/dialog.js).
 */
export default function DialogEditor({ content, onChange, noteOffset = 0 }) {
  const [data, setData] = useState(() => normalizeContentData('replica', content.data));
  const [activeLineId, setActiveLineId] = useState(() => data.lines[0]?.id ?? '');
  const [uploadingId, setUploadingId] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);
  const avatarTargetRef = useRef(null);

  // Примечания и ссылки в тексте реплик (Правки 5–6): номера сквозные по слайду
  const notes = collectPlainNotes(data);
  const links = collectPlainLinks(data);
  const numberById = plainNoteNumbers(data, noteOffset);

  const update = (patch) => {
    const next = { ...data, ...patch };
    setData(next);
    onChange(next);
  };

  const updateLine = (id, patch) =>
    update({ lines: data.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) });

  const addLine = () => {
    if (data.lines.length >= DIALOG_LIMITS.lines) return;

    const line = createDialogLine();
    update({ lines: [...data.lines, line] });
    setActiveLineId(line.id);
  };

  const removeLine = (id) => {
    if (data.lines.length <= 1) return;

    const lines = data.lines.filter((line) => line.id !== id);
    update({ lines });
    if (activeLineId === id) setActiveLineId(lines[0]?.id ?? '');
  };

  // Горячие клавиши работают, пока фокус внутри карточки диалога
  const handleHotkeys = (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.altKey) return;

    const side = POSITION_HOTKEYS[event.key.toLowerCase()];
    if (!side || !activeLineId) return;

    event.preventDefault();
    updateLine(activeLineId, { side });
  };

  const pickAvatar = (lineId) => {
    avatarTargetRef.current = lineId;
    fileInputRef.current?.click();
  };

  const handleAvatarFile = async (file) => {
    const lineId = avatarTargetRef.current;
    if (!file || !lineId || uploadingId) return;

    setUploadingId(lineId);
    setUploadError(null);

    const result = await uploadImage(file);
    setUploadingId(null);

    if (!result.ok) {
      setUploadError(result.message);
      return;
    }

    updateLine(lineId, { avatar: result.file.url });
  };

  return (
    <div className="content-editor-form" onKeyDown={handleHotkeys}>
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_MIME_TYPES.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          handleAvatarFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {uploadError && <p className="content-field__error">{uploadError}</p>}

      {/* СЦЕНА */}
      {data.lines.map((line, index) => (
        <div
          key={line.id}
          role="group"
          aria-label={`Реплика ${index + 1}`}
          className={['dialog-line', activeLineId === line.id ? 'is-active' : ''].filter(Boolean).join(' ')}
          onFocusCapture={() => setActiveLineId(line.id)}
        >
          <div className="dialog-line__head">
            <span className="dialog-line__title">Реплика {index + 1}</span>

            <span className="dialog-line__tools">
              {DIALOG_SIDES.map((side) => (
                <ToolbarButton
                  key={side.value}
                  icon={side.icon}
                  label={`Позиция реплики — ${side.label}`}
                  hint={HOTKEY_HINTS[side.value]}
                  active={line.side === side.value}
                  onClick={() => updateLine(line.id, { side: side.value })}
                />
              ))}

              <ToolbarButton
                icon="trash"
                label="Удалить реплику"
                className="tool-btn--danger"
                disabled={data.lines.length <= 1}
                onClick={() => removeLine(line.id)}
              />
            </span>
          </div>

          <div className="content-field-row">
            <EditorField label="Персонаж" className="content-field--grow">
              <input
                className="input input--sm"
                value={line.character}
                maxLength={DIALOG_LIMITS.character}
                placeholder="Кто говорит"
                onChange={(event) => updateLine(line.id, { character: event.target.value })}
              />
            </EditorField>

            <EditorField label="Позиция персонажа" hint="Где стоит аватар: рядом с текстом или над ним">
              <select
                className="tool-select tool-select--sm"
                value={line.position}
                onChange={(event) => updateLine(line.id, { position: event.target.value })}
              >
                {DIALOG_POSITIONS.map((position) => (
                  <option key={position.value} value={position.value}>
                    {position.label}
                  </option>
                ))}
              </select>
            </EditorField>
          </div>

          <EditorField label="Изображение персонажа" hint={`PNG, JPEG, WebP, GIF или SVG — до ${MAX_IMAGE_SIZE / (1024 * 1024)} МБ`}>
            <div className="dialog-line__avatar">
              {line.avatar ? (
                <img
                  className="dialog-line__avatar-img"
                  src={line.avatar}
                  alt=""
                  style={dialogAvatarStyle(line)}
                />
              ) : (
                <span className="dialog-line__avatar-empty" aria-hidden="true">
                  <Icon name="user" size={16} />
                </span>
              )}

              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => pickAvatar(line.id)}
                disabled={uploadingId === line.id}
              >
                <Icon
                  name={uploadingId === line.id ? 'loader' : 'upload'}
                  size={14}
                  className={uploadingId === line.id ? 'icon--spin' : undefined}
                />
                {uploadingId === line.id ? 'Загружаем…' : line.avatar ? 'Заменить' : 'Загрузить'}
              </button>

              {line.avatar && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => updateLine(line.id, { avatar: '' })}>
                  <Icon name="trash" size={14} />
                  Убрать
                </button>
              )}
            </div>

            {/* Какая часть картинки видна в кружке: перетаскивание, точки, ползунки */}
            {line.avatar && <AvatarFocusPicker line={line} onChange={(patch) => updateLine(line.id, patch)} />}
          </EditorField>

          <EditorField label="Текст реплики">
            <RichInput
              as="textarea"
              className="input input--sm"
              rows={3}
              value={line.text}
              placeholder="Что говорит персонаж"
              notes={notes}
              links={links}
              numberById={numberById}
              field="text"
              refId={line.id}
              onNotesChange={(next) => update({ notes: next })}
              onLinksChange={(next) => update({ links: next })}
              onAnnotate={({ value: nextValue, links: nextLinks, notes: nextNotes }) =>
                updateLine(line.id, {
                  text: nextValue,
                  ...(nextLinks ? { links: nextLinks } : {}),
                  ...(nextNotes ? { notes: nextNotes } : {}),
                })
              }
              onChange={(event) => updateLine(line.id, { text: event.target.value })}
            />
          </EditorField>
        </div>
      ))}

      <div className="content-actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={addLine}
          disabled={data.lines.length >= DIALOG_LIMITS.lines}
        >
          <Icon name="plus" size={14} />
          Добавить реплику
        </button>
      </div>

      {/* НАСТРОЙКИ */}
      <details className="dialog-settings">
        <summary className="dialog-settings__summary">
          <Icon name="settings" size={14} />
          Оформление диалога
        </summary>

        <div className="dialog-settings__body">
          <EditorField label={`Размер персонажа — ${data.avatarSize} px`} hint="Высота аватара на слайде">
            <input
              className="dialog-range"
              type="range"
              min={DIALOG_LIMITS.avatarSize[0]}
              max={DIALOG_LIMITS.avatarSize[1]}
              step={4}
              value={data.avatarSize}
              onChange={(event) => update({ avatarSize: Number(event.target.value) })}
            />
          </EditorField>

          <div className="content-field-row">
            <EditorField label="Цвет облака" className="content-field--grow">
              <div className="dialog-color">
                <input
                  type="color"
                  className="dialog-color__input"
                  value={data.bubbleColor || DIALOG_COLOR_FALLBACK.bubble}
                  onChange={(event) => update({ bubbleColor: event.target.value })}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!data.bubbleColor}
                  onClick={() => update({ bubbleColor: '' })}
                >
                  Как в теме
                </button>
              </div>
            </EditorField>

            <EditorField label="Цвет рамки" className="content-field--grow">
              <div className="dialog-color">
                <input
                  type="color"
                  className="dialog-color__input"
                  value={data.borderColor || DIALOG_COLOR_FALLBACK.border}
                  onChange={(event) => update({ borderColor: event.target.value })}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!data.borderColor}
                  onClick={() => update({ borderColor: '' })}
                >
                  Как в теме
                </button>
              </div>
            </EditorField>
          </div>

          <div className="content-field-row">
            <EditorField label={`Толщина рамки — ${data.borderWidth} px`} className="content-field--grow">
              <input
                className="dialog-range"
                type="range"
                min={DIALOG_LIMITS.borderWidth[0]}
                max={DIALOG_LIMITS.borderWidth[1]}
                value={data.borderWidth}
                onChange={(event) => update({ borderWidth: Number(event.target.value) })}
              />
            </EditorField>

            <EditorField label={`Скругление — ${data.radius} px`} className="content-field--grow">
              <input
                className="dialog-range"
                type="range"
                min={DIALOG_LIMITS.radius[0]}
                max={DIALOG_LIMITS.radius[1]}
                value={data.radius}
                onChange={(event) => update({ radius: Number(event.target.value) })}
              />
            </EditorField>
          </div>

          <div className="content-field-row">
            <EditorField label="Хвостик">
              <label className="dialog-check">
                <input
                  type="checkbox"
                  checked={data.showTail}
                  onChange={(event) => update({ showTail: event.target.checked })}
                />
                Показывать хвостик
              </label>
            </EditorField>

            <EditorField label="Направление хвостика">
              <select
                className="tool-select tool-select--sm"
                value={data.tail}
                disabled={!data.showTail}
                onChange={(event) => update({ tail: event.target.value })}
              >
                {DIALOG_TAILS.map((tail) => (
                  <option key={tail.value} value={tail.value}>
                    {tail.label}
                  </option>
                ))}
              </select>
            </EditorField>

            <EditorField label="Выравнивание текста">
              <select
                className="tool-select tool-select--sm"
                value={data.textAlign}
                onChange={(event) => update({ textAlign: event.target.value })}
              >
                {DIALOG_TEXT_ALIGNS.map((align) => (
                  <option key={align.value} value={align.value}>
                    {align.label}
                  </option>
                ))}
              </select>
            </EditorField>
          </div>
        </div>
      </details>

      {/* ПРЕДПРОСМОТР */}
      <div className="content-dialog-preview">
        <span className="content-field__label">Предпросмотр</span>
        <DialogView data={data} notes={notes} links={links} numberById={numberById} />
      </div>
    </div>
  );
}

/**
 * Область картинки в кружке аватара.
 *
 * Аватар — круг, поэтому от широкой картинки видно только середину. Здесь автор
 * выбирает, какая часть попадёт в кружок: картинку можно перетащить мышью или
 * пальцем, задать точку в сетке 3 × 3, подстроить сдвиг ползунками и увеличить
 * масштаб. Результат сразу виден в кружке слева и в предпросмотре диалога.
 */
function AvatarFocusPicker({ line, onChange }) {
  const focus = normalizeDialogFocus(line.avatarFocus);
  const zoom = normalizeDialogZoom(line.avatarZoom);

  // Тянем картинку за курсором: сдвиг курсора переводится в проценты картинки.
  // При масштабе 2× видимая область двигается вдвое медленнее — так картинка
  // ходит под пальцем, как в обычном кроппере.
  const startDrag = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;

    const handleMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startX) / box.width) * (100 / zoom);
      const dy = ((moveEvent.clientY - startY) / box.height) * (100 / zoom);
      onChange({ avatarFocus: normalizeDialogFocus({ x: focus.x - dx, y: focus.y - dy }) });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div className="dialog-focus">
      <span
        className="dialog-focus__preview"
        title="Перетащите картинку, чтобы выбрать область"
        onPointerDown={startDrag}
      >
        <img
          className="dialog-focus__img"
          src={line.avatar}
          alt="Область картинки в кружке"
          draggable={false}
          style={dialogAvatarStyle(line)}
        />
      </span>

      <div className="dialog-focus__controls">
        <div className="dialog-focus__grid" role="group" aria-label="Какая часть картинки видна в кружке">
          {DIALOG_FOCUS_POINTS.map((point) => {
            const active = focus.x === point.x && focus.y === point.y;

            return (
              <button
                key={point.id}
                type="button"
                className={['dialog-focus__point', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                aria-label={point.label}
                aria-pressed={active}
                onClick={() => onChange({ avatarFocus: { x: point.x, y: point.y } })}
              />
            );
          })}
        </div>

        <label className="dialog-focus__range">
          <span>Сдвиг по горизонтали — {focus.x} %</span>
          <input
            className="dialog-range"
            type="range"
            min="0"
            max="100"
            value={focus.x}
            onChange={(event) => onChange({ avatarFocus: { ...focus, x: Number(event.target.value) } })}
          />
        </label>

        <label className="dialog-focus__range">
          <span>Сдвиг по вертикали — {focus.y} %</span>
          <input
            className="dialog-range"
            type="range"
            min="0"
            max="100"
            value={focus.y}
            onChange={(event) => onChange({ avatarFocus: { ...focus, y: Number(event.target.value) } })}
          />
        </label>

        <label className="dialog-focus__range">
          <span>Масштаб — {zoom}×</span>
          <input
            className="dialog-range"
            type="range"
            min={DIALOG_LIMITS.avatarZoom[0]}
            max={DIALOG_LIMITS.avatarZoom[1]}
            step={DIALOG_ZOOM_STEP}
            value={zoom}
            onChange={(event) => onChange({ avatarZoom: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}
