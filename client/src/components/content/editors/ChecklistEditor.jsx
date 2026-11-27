import { useState } from 'react';
import EditorField, { EditorActions } from './EditorField.jsx';
import RichInput from './RichInput.jsx';
import Icon from '../../ui/Icon.jsx';
import { CHECKLIST_COLUMNS, CONTENT_LIMITS, normalizeContentData } from '../../../utils/helpers.js';
import { collectPlainLinks } from '../../../utils/links.js';
import { collectPlainNotes, plainNoteNumbers } from '../../../utils/notes.js';

const makeId = () =>
  globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Приводит пункты к { id, text, checked } и гарантирует хотя бы один пункт. */
function prepare(data) {
  const initial = normalizeContentData('checklist', data);
  const items = (Array.isArray(initial.items) ? initial.items : []).map((item, index) => ({
    id: String(item?.id ?? index + 1),
    text: String(item?.text ?? ''),
    checked: Boolean(item?.checked),
  }));

  return {
    ...initial,
    columns: CHECKLIST_COLUMNS.includes(Number(initial.columns)) ? Number(initial.columns) : 1,
    items: items.length > 0 ? items : [{ id: '1', text: '', checked: false }],
  };
}

/** Редактор чек-листа: заголовок, число столбцов и пункты с отметками. */
export default function ChecklistEditor({ content, onChange, noteOffset = 0 }) {
  const [data, setData] = useState(() => prepare(content.data));

  // Примечания к заголовку и пунктам (Правка 5) и ссылки (Правка 6): номера — номера слайда
  const notes = collectPlainNotes(data);
  const links = collectPlainLinks(data);
  const numberById = plainNoteNumbers(data, noteOffset);
  const setNotes = (next) => update({ ...data, notes: next });
  const setLinks = (next) => update({ ...data, links: next });

  const update = (next) => {
    setData(next);
    onChange(next);
  };

  const patchItem = (itemId, patch) =>
    update({ ...data, items: data.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) });

  const addItem = () => {
    if (data.items.length >= CONTENT_LIMITS.checklistItems) return;
    update({ ...data, items: [...data.items, { id: makeId(), text: '', checked: false }] });
  };

  const removeItem = (itemId) => {
    if (data.items.length <= 1) return;
    // Примечания и ссылки удалённого пункта не должны занимать номер на слайде
    const notes = (data.notes ?? []).filter((note) => !(note?.field === 'item' && note.ref === itemId));
    const links = (data.links ?? []).filter((link) => !(link?.field === 'item' && link.ref === itemId));
    update({ ...data, items: data.items.filter((item) => item.id !== itemId), notes, links });
  };

  const moveItem = (index, direction) => {
    const next = index + direction;
    if (next < 0 || next >= data.items.length) return;

    const items = [...data.items];
    [items[index], items[next]] = [items[next], items[index]];
    update({ ...data, items });
  };

  return (
    <div className="content-editor-form">
      <div className="content-field-row">
        <EditorField label="Заголовок" className="content-field--grow">
          <RichInput
            className="input input--sm"
            value={data.title}
            placeholder="Чек-лист"
            notes={notes}
            links={links}
            numberById={numberById}
            field="title"
            refId=""
            onNotesChange={setNotes}
            onLinksChange={setLinks}
            onAnnotate={({ value: nextValue, links: nextLinks, notes: nextNotes }) =>
              update({
                ...data,
                title: nextValue ?? data.title,
                links: nextLinks ?? data.links,
                notes: nextNotes ?? data.notes,
              })
            }
            onChange={(event) => update({ ...data, title: event.target.value })}
          />
        </EditorField>

        <EditorField label="Столбцы">
          <select
            className="tool-select tool-select--sm"
            value={data.columns}
            onChange={(event) => update({ ...data, columns: Number(event.target.value) })}
          >
            {CHECKLIST_COLUMNS.map((columns) => (
              <option key={columns} value={columns}>
                {columns}
              </option>
            ))}
          </select>
        </EditorField>
      </div>

      <ul className="checklist-editor">
        {data.items.map((item, index) => (
          <li key={item.id} className="checklist-editor__item">
            <label className="checkbox checklist-editor__check">
              <input
                type="checkbox"
                checked={item.checked}
                aria-label={`Отметить пункт ${index + 1}`}
                onChange={(event) => patchItem(item.id, { checked: event.target.checked })}
              />
            </label>

            <RichInput
              className={item.checked ? 'input input--sm checklist-editor__text is-checked' : 'input input--sm checklist-editor__text'}
              value={item.text}
              placeholder={`Пункт ${index + 1}`}
              aria-label={`Текст пункта ${index + 1}`}
              notes={notes}
              links={links}
              numberById={numberById}
              field="item"
              refId={item.id}
              onNotesChange={setNotes}
              onLinksChange={setLinks}
              onAnnotate={({ value: nextValue, links: nextLinks, notes: nextNotes }) =>
                update({
                  ...data,
                  items: data.items.map((entry) => (entry.id === item.id ? { ...entry, text: nextValue } : entry)),
                  links: nextLinks ?? data.links,
                  notes: nextNotes ?? data.notes,
                })
              }
              onChange={(event) => patchItem(item.id, { text: event.target.value })}
            />

            <span className="checklist-editor__actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="Переместить выше"
                disabled={index === 0}
                onClick={() => moveItem(index, -1)}
              >
                <Icon name="chevronUp" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Переместить ниже"
                disabled={index === data.items.length - 1}
                onClick={() => moveItem(index, 1)}
              >
                <Icon name="chevronDown" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                aria-label="Удалить пункт"
                disabled={data.items.length <= 1}
                onClick={() => removeItem(item.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <EditorActions>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={addItem}
          disabled={data.items.length >= CONTENT_LIMITS.checklistItems}
        >
          <Icon name="plus" size={14} /> Добавить пункт
        </button>
        <span className="content-field__hint">Пунктов: {data.items.length}</span>
      </EditorActions>
    </div>
  );
}
