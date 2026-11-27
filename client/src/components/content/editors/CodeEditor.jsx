import { useRef, useState } from 'react';
import CodeSurface from '../CodeSurface.jsx';
import EditorField from './EditorField.jsx';
import RichInput from './RichInput.jsx';
import { countCodeLines } from '../../../utils/code.js';
import { CODE_LANGUAGES, normalizeContentData } from '../../../utils/helpers.js';
import { collectPlainLinks } from '../../../utils/links.js';
import { collectPlainNotes, plainNoteNumbers } from '../../../utils/notes.js';

/** Редактор фрагмента кода: язык, имя файла и текст (Tab = два пробела). */
export default function CodeEditor({ content, onChange, noteOffset = 0 }) {
  const [data, setData] = useState(() => normalizeContentData('code', content.data));
  const gutterRef = useRef(null);

  // Примечания и ссылки в коде (Правки 5–6): номер примечания — номер слайда
  const notes = collectPlainNotes(data);
  const links = collectPlainLinks(data);
  const numberById = plainNoteNumbers(data, noteOffset);

  const update = (patch) => {
    const next = { ...data, ...patch };
    setData(next);
    onChange(next);
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Tab') return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;

    update({ code: nextValue });

    // Курсор после вставленных пробелов (значение обновится на следующем рендере)
    requestAnimationFrame(() => {
      textarea.setSelectionRange(selectionStart + 2, selectionStart + 2);
    });
  };

  /** Жёлоб с номерами строк прокручивается вместе с текстом (как в VS Code). */
  const syncGutter = (event) => {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const lines = countCodeLines(data.code);

  return (
    <div className="content-editor-form">
      <div className="content-field-row">
        <EditorField label="Язык">
          <select
            className="tool-select tool-select--sm"
            value={data.language}
            onChange={(event) => update({ language: event.target.value })}
          >
            {CODE_LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </EditorField>

        <EditorField label="Имя файла" className="content-field--grow">
          <input
            className="input input--sm"
            value={data.filename}
            placeholder="например, index.js"
            onChange={(event) => update({ filename: event.target.value })}
          />
        </EditorField>
      </div>

      <EditorField label="Код" hint={`Строк: ${lines}`}>
        <CodeSurface code={data.code} className="code-surface--editor" gutterRef={gutterRef}>
          <RichInput
            as="textarea"
            className="input input--sm code-editor"
            rows={8}
            wrap="off"
            spellCheck={false}
            value={data.code}
            placeholder="// Вставьте код"
            notes={notes}
            links={links}
            numberById={numberById}
            field="code"
            refId=""
            onNotesChange={(next) => update({ notes: next })}
            onLinksChange={(next) => update({ links: next })}
            onAnnotate={({ value: nextValue, links: nextLinks, notes: nextNotes }) =>
              update({ code: nextValue, links: nextLinks ?? data.links, notes: nextNotes ?? data.notes })
            }
            onChange={(event) => update({ code: event.target.value })}
            onScroll={syncGutter}
            onKeyDown={handleKeyDown}
          />
        </CodeSurface>
      </EditorField>
    </div>
  );
}
