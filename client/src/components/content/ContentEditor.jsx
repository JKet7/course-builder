import { useRef, useState } from 'react';
import TiptapEditor from '../editor/TiptapEditor.jsx';
import ChecklistEditor from './editors/ChecklistEditor.jsx';
import CodeEditor from './editors/CodeEditor.jsx';
import DialogEditor from './editors/DialogEditor.jsx';
import ImageEditor from './editors/ImageEditor.jsx';
import ImportantStyleFields from './editors/ImportantStyleFields.jsx';
import TableEditor from './editors/TableEditor.jsx';
import VideoEditor from './editors/VideoEditor.jsx';
import { importantBlockStyle, normalizeImportantStyle, withImportantStyle } from '../../utils/important.js';
import useAutoSave, { SAVE_STATUS_LABELS } from './useAutoSave.js';

const TEXT_TYPES = new Set(['text', 'important']);

/**
 * Редактор фрагмента контента: у каждого типа своя форма,
 * все изменения уходят на сервер через автосохранение (700 мс).
 * noteOffset — примечания предыдущих фрагментов слайда (номера сквозные).
 *
 * «Важное» — Tiptap-документ с оформлением в data.important (цвет фона и
 * рамки, толщина, скругление). Tiptap возвращает только { type, content },
 * поэтому при каждом сохранении оформление приклеивается заново
 * (withImportantStyle), а сам блок сразу рисуется с новым цветом.
 */
export default function ContentEditor({ content, onSave, onActivate, noteOffset = 0 }) {
  const { status, queue } = useAutoSave(onSave);
  const isText = TEXT_TYPES.has(content.type);

  // Оформление и последний текст «Важного» держим в ref: цвет применяется
  // сразу, а сохраняется вместе с документом — при вводе текста оформление
  // не должно откатываться к ещё не сохранённому значению из props.
  const [importantStyle, setImportantStyle] = useState(() => normalizeImportantStyle(content.data?.important));
  const styleRef = useRef(importantStyle);
  const importantEditor = useRef(null);

  /** Самый свежий документ «Важного»: несохранённый текст берём из Tiptap. */
  const importantDoc = () => {
    const editor = importantEditor.current;
    return editor && !editor.isDestroyed ? editor.getJSON() : content.data;
  };

  const saveImportant = (doc) => queue(withImportantStyle(doc, { important: styleRef.current }));

  const applyImportantStyle = (next) => {
    styleRef.current = next;
    setImportantStyle(next);
    queue(withImportantStyle(importantDoc(), { important: next }));
  };

  const renderForm = () => {
    switch (content.type) {
      case 'text':
        return (
          <TiptapEditor
            value={content.data}
            noteOffset={noteOffset}
            placeholder="Начните печатать текст…"
            onChange={queue}
            onFocus={(editor) => onActivate?.(editor)}
          />
        );
      case 'important':
        return (
          <div className="content-important content-important--edit" style={importantBlockStyle({ important: importantStyle })}>
            <ImportantStyleFields value={importantStyle} onChange={applyImportantStyle} />
            <TiptapEditor
              value={content.data}
              noteOffset={noteOffset}
              placeholder="Важное замечание…"
              onChange={saveImportant}
              onFocus={(editor) => {
                importantEditor.current = editor;
                onActivate?.(editor);
              }}
            />
          </div>
        );
      case 'image':
        return <ImageEditor content={content} noteOffset={noteOffset} onChange={queue} />;
      case 'video':
        return <VideoEditor content={content} noteOffset={noteOffset} onChange={queue} />;
      case 'table':
        return <TableEditor content={content} noteOffset={noteOffset} onChange={queue} onActivate={onActivate} />;
      case 'checklist':
        return <ChecklistEditor content={content} noteOffset={noteOffset} onChange={queue} />;
      case 'code':
        return <CodeEditor content={content} noteOffset={noteOffset} onChange={queue} />;
      case 'replica':
        return <DialogEditor content={content} noteOffset={noteOffset} onChange={queue} />;
      default:
        return <p className="content-hint">Неизвестный тип контента: {content.type}</p>;
    }
  };

  return (
    <div className={isText ? 'content-editor' : 'content-editor content-editor--form'}>
      {renderForm()}
      <span className={`content-editor__status content-editor__status--${status}`} role="status">
        {SAVE_STATUS_LABELS[status]}
      </span>
    </div>
  );
}


