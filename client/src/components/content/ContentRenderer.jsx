import { Fragment, useEffect, useState } from 'react';
import CodeSurface from './CodeSurface.jsx';
import DialogView from './DialogView.jsx';
import ImageShapes from './ImageShapes.jsx';
import NoteTip, { useNoteTip } from './NoteTip.jsx';
import RichText, { LinkNode } from './RichText.jsx';
import Icon from '../ui/Icon.jsx';
import {
  isChecklistItemChecked,
  readChecklistProgress,
  setChecklistItemChecked,
} from '../../utils/checklistProgress.js';
import { safeCodeText } from '../../utils/code.js';
import { getCodeLanguageLabel, getVideoEmbed, normalizeContentData } from '../../utils/helpers.js';
import { clampImageWidth, collectImageMarkers, collectImageShapes, cropImageStyle, imageFrameRatio } from '../../utils/image.js';
import { importantBlockStyle } from '../../utils/important.js';
import { annotateListNumbering } from '../../utils/listNumbering.js';
import { collectPlainLinks } from '../../utils/links.js';
import { NOTE_MARK_TYPE, annotateNotes, collectNotes, collectPlainNotes, plainNoteNumbers } from '../../utils/notes.js';
import { isCovered, mergeAt } from '../../utils/table.js';

/**
 * Просмотр Tiptap JSON без редактора (режим чтения).
 * Поддерживает абзацы, заголовки, списки, цитаты, код, ссылки и основные метки.
 * Номера многоуровневых списков вычисляются из структуры (annotateListNumbering).
 * Ссылки (Правка 6): внешние открываются в новой вкладке, внутренние вызывают
 * onLinkClick — переход по курсу; без обработчика (печать) остаются текстом.
 */
function renderTextNode(node, key, ctx) {
  if (!node.text) return null;

  let element = node.text;

  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') element = <strong>{element}</strong>;
    else if (mark.type === 'italic') element = <em>{element}</em>;
    else if (mark.type === 'underline') element = <u>{element}</u>;
    else if (mark.type === 'strike') element = <s>{element}</s>;
    else if (mark.type === 'code') element = <code>{element}</code>;
    else if (mark.type === 'link') {
      const attrs = mark.attrs ?? {};
      element = (
        <LinkNode
          link={{
            ...attrs,
            kind: attrs.linkKind ?? 'external',
            // У старых ссылок newTab не было — они открывались в новой вкладке
            newTab: attrs.newTab ?? attrs.target === '_blank',
          }}
          onLinkClick={ctx?.onLinkClick}
        >
          {element}
        </LinkNode>
      );
    } else if (mark.type === 'highlight') {
      element = <mark style={mark.attrs?.color ? { backgroundColor: mark.attrs.color } : undefined}>{element}</mark>;
    } else if (mark.type === NOTE_MARK_TYPE) {
      // Примечание: слово подчёркнуто пунктиром, номер рисуется после последнего вхождения
      const { noteId, noteNumber, noteText, noteMarker } = mark.attrs ?? {};
      element = (
        <>
          <span
            className="inline-note"
            data-note-id={noteId}
            data-note-number={noteNumber}
            data-note-text={noteText}
          >
            {element}
          </span>
          {noteMarker && (
            <span
              className="inline-note__mark"
              data-note-id={noteId}
              data-note-number={noteNumber}
              data-note-text={noteText}
              role="button"
              tabIndex={0}
              aria-label={`Примечание ${noteNumber}`}
            >
              {noteNumber}
            </span>
          )}
        </>
      );
    } else if (mark.type === 'textStyle') {
      const { color, fontFamily, fontSize } = mark.attrs ?? {};
      element = <span style={{ color, fontFamily, fontSize }}>{element}</span>;
    }
  }

  return <Fragment key={key}>{element}</Fragment>;
}

/** Отступ списка по настройкам уровня (em). */
function listIndentStyle(node) {
  const indent = Number(node.attrs?.listIndent);
  return Number.isFinite(indent) ? { paddingLeft: `${indent}em` } : undefined;
}

/** Висячий отступ маркера пункта — тот же, что у списка. */
function listItemStyle(node) {
  const indent = Number(node.attrs?.listIndent);
  return Number.isFinite(indent) ? { '--list-indent': `${indent}em` } : undefined;
}

function renderNodes(nodes, ctx) {
  return (nodes ?? []).map((node, index) => renderNode(node, index, ctx));
}

function renderNode(node, key, ctx) {
  if (node.type === 'text') return renderTextNode(node, key, ctx);

  const children = renderNodes(node.content, ctx);

  switch (node.type) {
    case 'doc':
      return <Fragment key={key}>{children}</Fragment>;
    case 'paragraph':
      return (
        <p key={key} style={node.attrs?.textAlign ? { textAlign: node.attrs.textAlign } : undefined}>
          {children}
        </p>
      );
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level ?? 1, 1), 3);
      const Tag = `h${level}`;
      return (
        <Tag key={key} style={node.attrs?.textAlign ? { textAlign: node.attrs.textAlign } : undefined}>
          {children}
        </Tag>
      );
    }
    case 'bulletList':
      return (
        <ul key={key} style={listIndentStyle(node)}>
          {children}
        </ul>
      );
    case 'orderedList':
      return (
        <ol key={key} style={listIndentStyle(node)}>
          {children}
        </ol>
      );
    case 'listItem':
      return (
        <li key={key} data-list-label={node.attrs?.listLabel} style={listItemStyle(node)}>
          {children}
        </li>
      );
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key} className="content-code">
          <code>{node.content?.map((child) => child.text ?? '').join('')}</code>
        </pre>
      );
    case 'hardBreak':
      return <br key={key} />;
    case 'horizontalRule':
      return <hr key={key} />;
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

/**
 * Tiptap-документ как React-разметка, без обёртки: тем же кодом рисуются
 * фрагмент «Текст» и ячейки таблицы.
 * Номера пунктов списков и примечаний вычисляются из структуры документа.
 */
export function DocContent({ doc, noteOffset = 0, onLinkClick }) {
  if (!doc || doc.type !== 'doc') return null;

  const annotated = annotateNotes(annotateListNumbering(doc), noteOffset);
  return <>{renderNodes(annotated.content, { onLinkClick })}</>;
}

/**
 * Tiptap-документ в режиме просмотра.
 * noteOffset — примечания предыдущих фрагментов слайда: номера сквозные по слайду.
 * onLinkClick — переход по внутренней ссылке (в печати не передаётся).
 */
export function TiptapContent({ doc, noteOffset = 0, onLinkClick }) {
  const { tip, openTip, closeTip } = useNoteTip();

  if (!doc || doc.type !== 'doc') return null;

  return (
    <div className="content-text" onMouseOver={openTip} onFocus={openTip} onClick={openTip}>
      <DocContent doc={doc} noteOffset={noteOffset} onLinkClick={onLinkClick} />
      {tip && <NoteTip tip={tip} onClose={closeTip} />}
    </div>
  );
}

/** Пустая подсказка, когда фрагмент ещё не заполнен. */
function EmptyHint({ children }) {
  return <p className="content-empty">{children}</p>;
}

/**
 * Полноэкранный просмотр картинки (пункт 2.1 правки): открывается двойным
 * кликом по изображению или кнопкой-лупой, закрывается крестиком, кликом по
 * фону и клавишей Esc. Прокрутка страницы на время просмотра блокируется.
 */
function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр картинки в полном размере"
      onClick={onClose}
    >
      <button type="button" className="image-lightbox__close" aria-label="Закрыть" onClick={onClose}>
        ×
      </button>
      <img
        className="image-lightbox__img"
        src={src}
        alt={alt ?? ''}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

/**
 * Картинка в просмотре и печати: обрезка, выравнивание в колонке, маркеры,
 * рамки выделения и просмотр в полном размере.
 *
 * Маркеры — примечания картинки (data.notes с field = 'marker'): номер общий со
 * слайдом, подсказка та же, что у примечаний текста (NoteTip). Клик по маркеру
 * (или наведение) показывает пояснение, двойной клик по картинке — увеличивает.
 * Рамки выделения (data.shapes) — цветные фигуры поверх картинки, общие с
 * редактором (components/content/ImageShapes.jsx).
 */
function ImageView({ data, notes, numberById, links, onLinkClick }) {
  const { tip, openTip, closeTip } = useNoteTip();
  // Натуральные пропорции: высота / ширина. Нужны для обрезки и свободных пропорций.
  const [natural, setNatural] = useState(null);
  const [zoomed, setZoomed] = useState(false);

  if (!data.url) {
    return <EmptyHint>Картинка не добавлена</EmptyHint>;
  }

  const markers = collectImageMarkers(data);
  const shapes = collectImageShapes(data);
  const ratio = imageFrameRatio(data, natural);
  const cropStyle = ratio ? cropImageStyle(data.crop) : null;

  return (
    <figure className={`content-image content-image--${data.align}`}>
      <div className="content-image__media" style={{ width: `${clampImageWidth(data.width)}%` }}>
        <div
          className="content-image__frame"
          style={ratio ? { aspectRatio: String(ratio) } : undefined}
          onMouseOver={openTip}
          onFocus={openTip}
          onClick={openTip}
          onDoubleClick={() => setZoomed(true)}
        >
          <img
            className="content-image__img"
            src={data.url}
            alt={data.alt ?? ''}
            loading="lazy"
            style={cropStyle ?? undefined}
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0) setNatural(img.naturalHeight / img.naturalWidth);
            }}
          />

          <ImageShapes shapes={shapes} />

          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className="content-image__marker"
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              data-note-id={marker.id}
              data-note-number={numberById.get(marker.id)}
              data-note-text={marker.text}
              aria-label={`Маркер ${numberById.get(marker.id) ?? ''}: ${marker.text}`}
            >
              <span className="content-image__marker-number">{numberById.get(marker.id)}</span>
            </button>
          ))}

          <button
            type="button"
            className="content-image__zoom"
            aria-label="Открыть в полном размере"
            onClick={() => setZoomed(true)}
          >
            <Icon name="search" size={15} />
          </button>
        </div>
      </div>

      {data.caption && (
        <figcaption>
          <RichText
            value={data.caption}
            notes={notes}
            links={links}
            field="caption"
            refId=""
            numberById={numberById}
            onLinkClick={onLinkClick}
          />
        </figcaption>
      )}

      {zoomed && <ImageLightbox src={data.url} alt={data.alt} onClose={() => setZoomed(false)} />}
      {tip && <NoteTip tip={tip} onClose={closeTip} />}
    </figure>
  );
}

function VideoView({ data, notes, numberById, links, onLinkClick }) {
  const embed = getVideoEmbed(data.url);

  if (!embed) {
    return <EmptyHint>{data.url ? 'Ссылка на видео не распознана' : 'Видео не добавлено'}</EmptyHint>;
  }

  return (
    <div className="content-video">
      {embed.provider === 'file' ? (
        <video className="video-player" src={embed.embedUrl} controls preload="metadata" />
      ) : (
        <div className="video-embed">
          <iframe
            src={embed.embedUrl}
            title="Видео"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      {data.caption && (
        <p className="content-video__caption">
          <RichText
            value={data.caption}
            notes={notes}
            links={links}
            field="caption"
            refId=""
            numberById={numberById}
            onLinkClick={onLinkClick}
          />
        </p>
      )}
    </div>
  );
}

/**
 * Таблица в просмотре. Ячейки — Tiptap-документы, поэтому внутри работают
 * жирный, курсив, цвет, размер, списки, ссылки и примечания (как в «Тексте»).
 * Объединённые ячейки (data.merges) рисуются одним <td>/<th> с rowSpan/colSpan.
 * Номера примечаний сквозные по слайду: noteOffset — примечания предыдущих
 * фрагментов, дальше считаем примечания ячеек построчно.
 */
function TableView({ data, noteOffset = 0, onLinkClick }) {
  const { tip, openTip, closeTip } = useNoteTip();
  const cells = data.cells ?? [];
  const merges = data.merges ?? [];
  const offsets = new Map();
  let running = noteOffset;

  cells.forEach((row, rowIndex) => {
    row.forEach((doc, columnIndex) => {
      if (isCovered(merges, rowIndex, columnIndex)) return;
      offsets.set(`${rowIndex}-${columnIndex}`, running);
      running += collectNotes(doc).length;
    });
  });

  return (
    <div className="content-table-wrap">
      <table className="content-table">
        <tbody>
          {cells.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((doc, columnIndex) => {
                if (isCovered(merges, rowIndex, columnIndex)) return null;

                const merge = mergeAt(merges, rowIndex, columnIndex);
                const content = (
                  <div className="content-table__cell" onMouseOver={openTip} onFocus={openTip} onClick={openTip}>
                    <DocContent
                      doc={doc}
                      noteOffset={offsets.get(`${rowIndex}-${columnIndex}`) ?? noteOffset}
                      onLinkClick={onLinkClick}
                    />
                  </div>
                );
                const span = {
                  rowSpan: merge && merge.rowSpan > 1 ? merge.rowSpan : undefined,
                  colSpan: merge && merge.colSpan > 1 ? merge.colSpan : undefined,
                };

                return rowIndex === 0 && data.headerRow ? (
                  <th key={columnIndex} {...span}>
                    {content}
                  </th>
                ) : (
                  <td key={columnIndex} {...span}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {tip && <NoteTip tip={tip} onClose={closeTip} />}
    </div>
  );
}

/**
 * Чек-лист в просмотре. В режиме читателя (checklistBlockId задан) пункты
 * интерактивны: отметка сразу пишется в localStorage и переживает перезагрузку.
 * В печати и других вызовах без blockId остаётся авторское состояние checked.
 */
function ChecklistView({ data, notes, numberById, links, onLinkClick, checklistBlockId = null, contentId = '' }) {
  const columns = Number(data.columns) === 2 ? 'content-checklist--two' : '';
  const interactive = Boolean(checklistBlockId && contentId);
  const [progress, setProgress] = useState(() =>
    interactive ? readChecklistProgress(checklistBlockId) : {},
  );

  // При переходе на другой блок тот же компонент может остаться смонтированным
  useEffect(() => {
    setProgress(interactive ? readChecklistProgress(checklistBlockId) : {});
  }, [interactive, checklistBlockId]);

  const itemId = (item, index) => item.id ?? index;
  const isChecked = (item, index) =>
    interactive ? isChecklistItemChecked(progress, contentId, itemId(item, index)) : Boolean(item.checked);

  const toggle = (item, index) => {
    if (!interactive) return;
    setProgress(
      setChecklistItemChecked(checklistBlockId, contentId, itemId(item, index), !isChecked(item, index)),
    );
  };

  return (
    <div className={`content-checklist ${columns}${interactive ? ' content-checklist--interactive' : ''}`.trim()}>
      {data.title && (
        <p className="content-checklist__title">
          <RichText
            value={data.title}
            notes={notes}
            links={links}
            field="title"
            refId=""
            numberById={numberById}
            onLinkClick={onLinkClick}
          />
        </p>
      )}
      <ul className="content-checklist__list">
        {(data.items ?? []).map((item, index) => {
          const checked = isChecked(item, index);
          const box = (
            <span className="content-checklist__box" aria-hidden="true">
              {checked ? '✓' : ''}
            </span>
          );

          return (
            <li key={item.id ?? index} className={checked ? 'is-checked' : undefined}>
              {interactive ? (
                <label className="content-checklist__check">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`Отметить пункт ${index + 1}`}
                    onChange={() => toggle(item, index)}
                  />
                  {box}
                </label>
              ) : (
                box
              )}
              <span className="content-checklist__text">
                {item.text ? (
                  <RichText
                    value={item.text}
                    notes={notes}
                    links={links}
                    field="item"
                    refId={String(item.id ?? '')}
                    numberById={numberById}
                    onLinkClick={onLinkClick}
                  />
                ) : (
                  'Пустой пункт'
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CodeView({ data, notes, numberById, links, onLinkClick }) {
  const [copied, setCopied] = useState(false);
  const code = safeCodeText(data.code);

  const copyCode = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="content-code-wrap">
      <div className="content-code__head">
        <span className="content-code__meta">
          <span className="content-code__language">{getCodeLanguageLabel(data.language)}</span>
          {data.filename && <span className="content-code__filename">{data.filename}</span>}
        </span>
        <button type="button" className="icon-btn" aria-label="Скопировать код" onClick={copyCode}>
          {copied ? '✓' : '⧉'}
        </button>
      </div>
      <CodeSurface code={code} className="code-surface--view">
        <pre className="content-code">
          <code>
            {code ? (
              <RichText
                value={code}
                notes={notes}
                links={links}
                field="code"
                refId=""
                numberById={numberById}
                onLinkClick={onLinkClick}
              />
            ) : (
              '// код пока не добавлен'
            )}
          </code>
        </pre>
      </CodeSurface>
    </div>
  );
}

function ReplicaView({ data, notes, numberById, links, onLinkClick }) {
  return <DialogView data={data} notes={notes} links={links} numberById={numberById} onLinkClick={onLinkClick} />;
}

/** Содержимое без обёртки — для типов, у которых нет собственной рамки. */
function PlainContent({
  type,
  data,
  notes,
  numberById,
  links,
  onLinkClick,
  noteOffset,
  checklistBlockId,
  contentId,
}) {
  const shared = { notes, numberById, links, onLinkClick, noteOffset };

  switch (type) {
    case 'image':
      return <ImageView data={data} {...shared} />;
    case 'video':
      return <VideoView data={data} {...shared} />;
    case 'table':
      return <TableView data={data} {...shared} />;
    case 'checklist':
      return (
        <ChecklistView
          data={data}
          {...shared}
          checklistBlockId={checklistBlockId}
          contentId={contentId}
        />
      );
    case 'code':
      return <CodeView data={data} {...shared} />;
    case 'replica':
      return <ReplicaView data={data} {...shared} />;
    default:
      return <EmptyHint>Неизвестный тип контента: {type}</EmptyHint>;
  }
}

/**
 * Просмотр фрагмента контента без редактирования.
 * content: { type, data }
 * noteOffset — примечания предыдущих фрагментов слайда (номера сквозные).
 * onLinkClick — переход по внутренней ссылке; в печати не передаётся.
 * checklistBlockId — блок для сохранения отметок чек-листа (Правка 10).
 * Без него (печать) чек-лист показывает авторское состояние checked.
 */
export default function ContentRenderer({
  content,
  noteOffset = 0,
  onLinkClick,
  checklistBlockId = null,
}) {
  const data = normalizeContentData(content?.type, content?.data);

  if (content?.type === 'text') {
    return <TiptapContent doc={data} noteOffset={noteOffset} onLinkClick={onLinkClick} />;
  }

  if (content?.type === 'important') {
    // Цветной блок с рамкой, только текст: без иконки, подписи и крестика.
    // Оформление — в data.important (utils/important.js).
    return (
      <div className="content-important" style={importantBlockStyle(data)}>
        <TiptapContent doc={data} noteOffset={noteOffset} onLinkClick={onLinkClick} />
      </div>
    );
  }

  const notes = collectPlainNotes(data);
  const links = collectPlainLinks(data);
  const numberById = plainNoteNumbers(data, noteOffset);

  return (
    <PlainContent
      type={content?.type}
      data={data}
      notes={notes}
      links={links}
      numberById={numberById}
      noteOffset={noteOffset}
      onLinkClick={onLinkClick}
      checklistBlockId={checklistBlockId}
      contentId={content?.id ? String(content.id) : ''}
    />
  );
}

/* Конец файла */

