import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import ContentGrid from '../content/ContentGrid.jsx';
import MemoTitle, { memoTitleDoc } from './MemoTitle.jsx';
import TiptapEditor from '../editor/TiptapEditor.jsx';
import useAutoSave, { SAVE_STATUS_LABELS } from '../content/useAutoSave.js';
import { docToText } from '../../utils/helpers.js';
import { collectNotes } from '../../utils/notes.js';
import {
  CONTENT_BODY_VERSION,
  contentBodyContents,
  createBodyContent,
  normalizeContentBody,
} from '../../utils/contentBody.js';

/**
 * Карточка памятки: заголовок и содержимое из фрагментов.
 *
 * Карточки лежат в сетке слайда — так же, как раньше, только теперь слайдов
 * может быть несколько. Внутри карточки та же сетка контента, что у теории:
 * текст, картинка, видео, таблица, важное, код, диалог и чек-лист.
 *
 * Заголовок — такое же форматированное поле, как содержимое: Tiptap хранит
 * разметку в titleDoc, а простой текст дублируется в title для поиска.
 */
export default function MemoCard({
  cell,
  canEdit,
  onSave,
  onDelete,
  onMove,
  canMoveLeft = false,
  canMoveRight = false,
  onLinkClick,
  highlighted = false,
  highlightContentId = null,
  checklistBlockId = null,
}) {
  const [draft, setDraft] = useState(() => ({
    title: cell.title ?? '',
    titleDoc: memoTitleDoc(cell.title, cell.titleDoc),
    body: normalizeContentBody(cell.body, cell.id),
  }));
  const [error, setError] = useState(null);

  // Заголовок и тело сохраняются одним patch: обработчик Tiptap может
  // вызваться с замыканием первого рендера, поэтому свежие данные держим в ref.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const { status, queue } = useAutoSave((patch) => onSave(cell.id, patch));

  // В просмотре берём данные из стора: после автосохранения там уже новое тело
  const viewContents = useMemo(() => contentBodyContents(cell.body, cell.id), [cell.body, cell.id]);
  const contents = canEdit ? draft.body.contents : viewContents;

  // Примечания заголовка идут первыми: тело продолжает их нумерацию.
  const titleNoteCount = useMemo(
    () => collectNotes(canEdit ? draft.titleDoc : cell.titleDoc).length,
    [canEdit, draft.titleDoc, cell.titleDoc],
  );

  /** Ставит новый черновик и в state, и в ref для следующих сохранений. */
  const commitDraft = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  /** Сохраняет тело карточки и ставит его в очередь автосохранения. */
  const applyBody = useCallback(
    (nextContents) => {
      const current = draftRef.current;
      const value = current.title.trim();
      const body = { version: CONTENT_BODY_VERSION, contents: nextContents };
      const next = { ...current, body };

      commitDraft(next);

      if (!value) {
        setError('Заголовок не может быть пустым');
        return;
      }

      setError(null);
      queue({ title: value, titleDoc: current.titleDoc, body });
    },
    [commitDraft, queue],
  );

  /** Заголовок меняется как обычный форматированный текст (Tiptap JSON). */
  const applyTitle = useCallback(
    (titleDoc) => {
      const current = draftRef.current;
      const title = docToText(titleDoc);
      const next = { ...current, title, titleDoc };

      commitDraft(next);

      if (!title) {
        setError('Заголовок не может быть пустым');
        return;
      }

      setError(null);
      queue({ title, titleDoc, body: current.body });
    },
    [commitDraft, queue],
  );

  const handleAddContent = (type, at) => {
    const fragment = createBodyContent(type);
    const next = [...draftRef.current.body.contents];
    next.splice(at ?? next.length, 0, fragment);
    applyBody(next);
  };

  const handleSaveContent = (contentId, data) => {
    applyBody(
      draftRef.current.body.contents.map((item) => (item.id === contentId ? { ...item, data } : item)),
    );
  };

  const handleWidthChange = (contentId, width) => {
    applyBody(draftRef.current.body.contents.map((item) => (item.id === contentId ? { ...item, width } : item)));
  };

  const handleDeleteContent = (contentId) => {
    applyBody(draftRef.current.body.contents.filter((item) => item.id !== contentId));
  };

  const handleReorder = (orderedIds) => {
    const byId = new Map(draftRef.current.body.contents.map((item) => [item.id, item]));
    applyBody(orderedIds.map((id) => byId.get(id)).filter(Boolean));
  };

  if (!canEdit) {
    return (
      <article
        className={`memo-card memo-card--view${highlighted ? ' is-link-target' : ''}`}
        data-memo-id={cell.id}
      >
        <MemoTitle title={cell.title} titleDoc={cell.titleDoc} onLinkClick={onLinkClick} />
        <hr className="memo-card__divider" />
        <ContentGrid
          contents={viewContents}
          canEdit={false}
          highlightContentId={highlightContentId}
          checklistBlockId={checklistBlockId}
          noteOffset={titleNoteCount}
          onLinkClick={onLinkClick}
        />
      </article>
    );
  }

  return (
    <article className={`memo-card${highlighted ? ' is-link-target' : ''}`} data-memo-id={cell.id}>
      <header className="memo-card__head">
        <div className="memo-card__input">
          <TiptapEditor
            value={draft.titleDoc}
            placeholder="Название карточки"
            className="memo-card__title-editor"
            onChange={applyTitle}
          />
        </div>

        <span className={`content-editor__status content-editor__status--${status}`} role="status">
          {SAVE_STATUS_LABELS[status]}
        </span>

        <span className="memo-card__actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Переместить карточку левее"
            disabled={!canMoveLeft}
            onClick={() => onMove(cell.id, -1)}
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Переместить карточку правее"
            disabled={!canMoveRight}
            onClick={() => onMove(cell.id, 1)}
          >
            <Icon name="chevronRight" size={14} />
          </button>
          <button type="button" className="icon-btn icon-btn--danger" aria-label="Удалить карточку" onClick={() => onDelete(cell)}>
            <Icon name="trash" size={14} />
          </button>
        </span>
      </header>

      <hr className="memo-card__divider" />

      {error && (
        <span className="content-field__error" role="alert">
          {error}
        </span>
      )}

      <div className="memo-card__body">
        <ContentGrid
          contents={contents}
          canEdit
          highlightContentId={highlightContentId}
          checklistBlockId={checklistBlockId}
          noteOffset={titleNoteCount}
          emptyTitle="Карточка пока пуста"
          emptyHint="Добавьте текст, картинку, видео, таблицу, важное, код, диалог или чек-лист."
          onAddContent={handleAddContent}
          onSaveContent={handleSaveContent}
          onDeleteContent={handleDeleteContent}
          onWidthChange={handleWidthChange}
          onReorder={handleReorder}
          onLinkClick={onLinkClick}
        />
      </div>
    </article>
  );
}
