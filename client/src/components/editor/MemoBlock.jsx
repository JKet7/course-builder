import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../ui/ConfirmModal.jsx';
import Icon from '../ui/Icon.jsx';
import MemoSlide from '../memo/MemoSlide.jsx';
import { useInternalLink } from '../content/useInternalLink.js';
import DocumentSearch from './DocumentSearch.jsx';
import Navigation from './Navigation.jsx';
import Toolbar from './toolbar/Toolbar.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { useMemoStore } from '../../store/memoStore.js';
import { contentBodyContents } from '../../utils/contentBody.js';
import { getBlockContentLabel } from '../../utils/helpers.js';
import { useOptionalSearchParams } from '../../utils/router.js';

const EMPTY_SLIDES = [];

/**
 * Блок «Памятка»: слайды с сеткой карточек, содержание справа и переходы
 * между слайдами — как в блоке «Теория».
 *
 * Карточки остались прежними (заголовок и содержимое из фрагментов), но
 * теперь они принадлежат слайду: на экране один слайд со своей сеткой,
 * остальные открываются из содержания.
 */
export default function MemoBlock({ block }) {
  const isEditor = useAuthStore((state) => state.isEditor);
  const uiMode = useUiStore((state) => state.uiMode);
  const canEdit = isEditor && uiMode === 'edit';

  // Панель инструментов применяет команды к тексту карточки в фокусе
  const activeEditor = useEditorStore((state) => state.activeEditor);

  const storeBlockId = useMemoStore((state) => state.blockId);
  const allSlides = useMemoStore((state) => state.slides);
  const activeSlideId = useMemoStore((state) => state.activeSlideId);
  const loading = useMemoStore((state) => state.loading);
  const loaded = useMemoStore((state) => state.loaded);
  const error = useMemoStore((state) => state.error);
  const fetchSlides = useMemoStore((state) => state.fetchSlides);
  const setActiveSlide = useMemoStore((state) => state.setActiveSlide);
  const addSlide = useMemoStore((state) => state.addSlide);
  const updateSlide = useMemoStore((state) => state.updateSlide);
  const deleteSlide = useMemoStore((state) => state.deleteSlide);
  const moveSlide = useMemoStore((state) => state.moveSlide);
  const addCell = useMemoStore((state) => state.addCell);
  const updateCell = useMemoStore((state) => state.updateCell);
  const deleteCell = useMemoStore((state) => state.deleteCell);
  const moveCell = useMemoStore((state) => state.moveCell);

  const sameBlock = storeBlockId === block.id;
  const slides = sameBlock ? allSlides : EMPTY_SLIDES;
  const foundIndex = slides.findIndex((slide) => slide.id === activeSlideId);
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const activeSlide = slides[currentIndex] ?? null;
  const showSkeleton = slides.length === 0 && (loading || !sameBlock);
  const showEmpty = sameBlock && loaded && !loading && slides.length === 0 && !error;

  // Данные для поиска: слайд → его карточки → фрагменты карточек
  const searchableSlides = useMemo(
    () =>
      slides.map((slide, slideIndex) => ({
        id: slide.id,
        title: slide.title || `Слайд ${slideIndex + 1}`,
        cards: slide.cells.map((cell) => ({
          id: cell.id,
          title: cell.title || 'Без названия',
          contents: contentBodyContents(cell.body, cell.id),
        })),
      })),
    [slides],
  );

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Шаг 17: поиск по документу — панель, подсветка найденного фрагмента
  // и отложенная прокрутка к нему после переключения слайда.
  const [searchOpen, setSearchOpen] = useState(false);
  const [foundContentId, setFoundContentId] = useState(null);
  const pendingScroll = useRef(null);

  // Внутренняя ссылка (Правка 6): ?memo=<id> открывает карточку в её слайде.
  const searchParams = useOptionalSearchParams();
  const onInternalLink = useInternalLink();
  const targetMemoId = searchParams.get('memo');
  const [linkedId, setLinkedId] = useState(null);
  const handledMemo = useRef(null);

  useEffect(() => {
    fetchSlides(block.id);
  }, [block.id, fetchSlides]);

  useEffect(() => {
    if (!targetMemoId || handledMemo.current === targetMemoId) return undefined;

    const owner = slides.find((slide) => slide.cells.some((cell) => cell.id === targetMemoId));
    if (!owner) return undefined;

    handledMemo.current = targetMemoId;
    setActiveSlide(owner.id);

    const timer = setTimeout(() => {
      document
        .querySelector(`[data-memo-id="${targetMemoId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setLinkedId(targetMemoId);
    }, 80);

    return () => clearTimeout(timer);
  }, [targetMemoId, slides, setActiveSlide]);

  useEffect(() => {
    if (!linkedId) return undefined;
    const timer = setTimeout(() => setLinkedId(null), 2400);
    return () => clearTimeout(timer);
  }, [linkedId]);

  // Ctrl+F / Cmd+F открывают поиск, Esc закрывает панель (браузерный поиск
  // страницы здесь бесполезен: на экране только один слайд).
  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.key === 'Escape' && searchOpen) setSearchOpen(false);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  // Подсветка найденного фрагмента гаснет сама.
  useEffect(() => {
    if (!foundContentId) return undefined;

    const timer = setTimeout(() => setFoundContentId(null), 2400);
    return () => clearTimeout(timer);
  }, [foundContentId]);

  // После переключения слайда прокручиваем к найденному фрагменту или карточке.
  useEffect(() => {
    if (!pendingScroll.current) return undefined;

    const timer = setTimeout(() => {
      const contentId = pendingScroll.current;
      pendingScroll.current = null;
      document
        .querySelector(`[data-content-id="${contentId}"], [data-memo-id="${contentId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    return () => clearTimeout(timer);
  }, [activeSlide?.id]);

  // Клик или Enter по результату поиска: открыть слайд и подсветить цель.
  const handleSearchSelect = (result) => {
    if (!result.contentId) {
      if (result.slideId !== activeSlide?.id) setActiveSlide(result.slideId);
      return;
    }

    if (result.slideId === activeSlide?.id) {
      document
        .querySelector(`[data-content-id="${result.contentId}"], [data-memo-id="${result.contentId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      pendingScroll.current = result.contentId;
      setActiveSlide(result.slideId);
    }

    setFoundContentId(result.contentId);
  };

  const handleAddSlide = async () => {
    setActionError(null);
    const result = await addSlide(block.id);
    if (!result.ok) setActionError(result.message);
  };

  const handleAddCard = async () => {
    if (!activeSlide) return;

    setActionError(null);
    const result = await addCell(block.id, activeSlide.id);
    if (!result.ok) setActionError(result.message);
  };

  const handleMoveSlide = async (slideId, delta) => {
    const result = await moveSlide(block.id, slideId, delta);
    if (!result.ok) setActionError(result.message);
  };

  const handleMoveCard = async (slideId, cellId, delta) => {
    const result = await moveCell(block.id, slideId, cellId, delta);
    if (!result.ok) setActionError(result.message);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    const result =
      pendingDelete.kind === 'slide'
        ? await deleteSlide(pendingDelete.item.id)
        : await deleteCell(pendingDelete.item.id);
    setDeleting(false);

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    setPendingDelete(null);
  };

  return (
    <section className="memo-block">
      {canEdit && <Toolbar editor={activeEditor} />}

      {slides.length > 0 &&
        (searchOpen ? (
          <DocumentSearch
            slides={searchableSlides}
            activeSlideId={activeSlide?.id ?? null}
            placeholder="Найти в памятке — минимум 2 символа"
            ariaLabel="Найти в памятке"
            onSelect={handleSearchSelect}
            onClose={() => setSearchOpen(false)}
          />
        ) : (
          <div className="memo__search-row">
            <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={16} />
              Поиск по документу
            </Button>
            <span className="memo__search-hint">Ctrl + F</span>
          </div>
        ))}

      {actionError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{actionError}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
            Скрыть
          </Button>
        </div>
      )}

      <div className="memo-layout">
        <div className="memo__main">
          {error && (
            <div className="alert alert--error" role="alert">
              <Icon name="alert" size={18} />
              <span className="alert__text">{error}</span>
              <Button variant="ghost" size="sm" onClick={() => fetchSlides(block.id)}>
                Повторить
              </Button>
            </div>
          )}

          {showSkeleton && (
            <div className="slide-skeleton" aria-hidden="true">
              <span className="skeleton skeleton--title" />
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--line" />
            </div>
          )}

          {showEmpty && (
            <div className="empty-state empty-state--center">
              <Icon name="layers" size={32} />
              <p className="empty-state__title">В памятке пока нет слайдов</p>
              {canEdit ? (
                <>
                  <p>Слайд — это страница памятки: заголовок и сетка карточек с текстом, картинками и таблицами.</p>
                  <Button size="sm" onClick={handleAddSlide} title="Добавить слайд">
                    <Icon name="plus" size={16} />
                    Добавить слайд
                  </Button>
                </>
              ) : (
                <p>Как только редактор добавит слайды, они появятся здесь.</p>
              )}
            </div>
          )}

          {activeSlide && (
            <>
              <MemoSlide
                key={activeSlide.id}
                slide={activeSlide}
                index={currentIndex}
                canEdit={canEdit}
                onSaveSlide={updateSlide}
                onAddCard={handleAddCard}
                onSaveCell={updateCell}
                onDeleteCell={(cell) => setPendingDelete({ kind: 'cell', item: cell })}
                onMoveCell={handleMoveCard}
                onLinkClick={onInternalLink}
                highlighted={activeSlide.cells.some((cell) => cell.id === linkedId)}
                linkedCellId={linkedId}
                highlightContentId={foundContentId}
                checklistBlockId={canEdit ? null : block.id}
              />

              <Navigation
                index={currentIndex}
                total={slides.length}
                onPrev={() => setActiveSlide(slides[currentIndex - 1].id)}
                onNext={() => setActiveSlide(slides[currentIndex + 1].id)}
              />
            </>
          )}
        </div>

        <aside className="memo__side" aria-label="Содержание памятки">
          <div className="memo__side-head">
            <h2 className="memo__side-title">Содержание</h2>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={handleAddSlide} title="Добавить слайд">
                <Icon name="plus" size={16} />
              </Button>
            )}
          </div>

          {slides.length === 0 ? (
            <p className="memo__side-empty">Слайдов пока нет</p>
          ) : (
            <ol className="slide-list">
              {slides.map((slide, index) => (
                <li
                  key={slide.id}
                  className={slide.id === activeSlide?.id ? 'slide-list__item is-active' : 'slide-list__item'}
                >
                  <button type="button" className="slide-list__btn" onClick={() => setActiveSlide(slide.id)}>
                    <span className="slide-list__index">{index + 1}</span>
                    <span className="slide-list__title">{slide.title || `Слайд ${index + 1}`}</span>
                    <span className="slide-list__count">{slide.cells.length}</span>
                  </button>

                  {canEdit && (
                    <span className="slide-list__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Переместить слайд выше"
                        disabled={index === 0}
                        onClick={() => handleMoveSlide(slide.id, -1)}
                      >
                        <Icon name="chevronUp" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Переместить слайд ниже"
                        disabled={index === slides.length - 1}
                        onClick={() => handleMoveSlide(slide.id, 1)}
                      >
                        <Icon name="chevronDown" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label="Удалить слайд"
                        onClick={() => setPendingDelete({ kind: 'slide', item: slide })}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="memo__side-hint">{getBlockContentLabel('memo', slides.length)}</p>
        </aside>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete.kind === 'slide' ? 'Удалить слайд?' : 'Удалить карточку?'}
          message={
            <>
              <p className="modal__text">
                {pendingDelete.kind === 'slide'
                  ? `Слайд «${pendingDelete.item.title || 'Без названия'}» будет удалён вместе со всеми карточками.`
                  : `Карточка «${pendingDelete.item.title || 'Без названия'}» будет удалена вместе с содержимым.`}
              </p>
              <p className="modal__text modal__text--muted">Действие нельзя отменить.</p>
            </>
          }
          loading={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </section>
  );
}
