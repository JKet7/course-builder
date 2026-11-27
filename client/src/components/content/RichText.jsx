import { Fragment } from 'react';
import NoteTip, { useNoteTip } from './NoteTip.jsx';
import { annotateText } from '../../utils/plainText.js';
import { isInternalLink, linkTooltip, linksForField } from '../../utils/links.js';
import { notesForField } from '../../utils/notes.js';

/**
 * Ссылка в просмотре (Правка 6): внешняя — обычный <a>, внутренняя —
 * переход по курсу. Если обработчик перехода не передан (печать), внутренняя
 * ссылка остаётся подчёркнутым текстом.
 * children — сам текст ссылки (может быть обёрнут примечанием).
 */
export function LinkNode({ link, onLinkClick, children, className = '' }) {
  const internal = isInternalLink(link);
  const title = linkTooltip(link);

  if (internal) {
    if (!onLinkClick) {
      return (
        <span className={`content-link content-link--internal${className ? ` ${className}` : ''}`} title={title}>
          {children}
        </span>
      );
    }

    return (
      <a
        href={link.href}
        className={`content-link content-link--internal${className ? ` ${className}` : ''}`}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          onLinkClick(link);
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={link.href}
      className={`content-link content-link--external${className ? ` ${className}` : ''}`}
      target={link.newTab ? '_blank' : undefined}
      rel={link.newTab ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  );
}

/**
 * Обычный текст с примечаниями и ссылками (Правки 5–6).
 *
 * Используется фрагментами без Tiptap: ячейки таблицы, пункты чек-листа,
 * подписи картинки и видео, код, текст реплики. Обе аннотации раскладываются
 * по тексту одной функцией (utils/plainText.js), поэтому слово может быть
 * и ссылкой, и примечанием одновременно.
 */
export default function RichText({
  value,
  notes = [],
  links = [],
  field,
  refId = '',
  numberById,
  className,
  onLinkClick,
}) {
  const { tip, openTip, closeTip } = useNoteTip();
  const fieldNotes = notesForField(notes, field, refId);
  const fieldLinks = linksForField(links, field, refId);

  // Без аннотаций текст остаётся как есть: разметка не обрастает обёртками
  if (fieldNotes.length === 0 && fieldLinks.length === 0) {
    return <Fragment>{String(value ?? '')}</Fragment>;
  }

  const parts = annotateText(value, fieldNotes, fieldLinks);

  return (
    <span className={className} onMouseOver={openTip} onFocus={openTip} onClick={openTip}>
      {parts.map((part, index) => {
        let content = part.text;

        if (part.link) {
          content = (
            <LinkNode link={part.link} onLinkClick={onLinkClick}>
              {content}
            </LinkNode>
          );
        }

        const note = part.note;
        const number = note ? numberById?.get(note.id) : null;

        if (note) {
          content = (
            <span
              className="inline-note"
              data-note-id={note.id}
              data-note-number={number}
              data-note-text={note.text}
            >
              {content}
            </span>
          );
        }

        return (
          <Fragment key={index}>
            {content}

            {note && part.noteEnd && number ? (
              <span
                className="inline-note__mark"
                data-note-id={note.id}
                data-note-number={number}
                data-note-text={note.text}
                role="button"
                tabIndex={0}
                aria-label={`Примечание ${number}`}
              >
                {number}
              </span>
            ) : null}
          </Fragment>
        );
      })}

      {tip && <NoteTip tip={tip} onClose={closeTip} />}
    </span>
  );
}
