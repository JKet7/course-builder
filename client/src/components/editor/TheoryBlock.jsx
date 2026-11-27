import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../ui/ConfirmModal.jsx';
import Icon from '../ui/Icon.jsx';
import { useInternalLink } from '../content/useInternalLink.js';
import DocumentSearch from './DocumentSearch.jsx';
import Navigation from './Navigation.jsx';
import SlideGrid from './SlideGrid.jsx';
import Toolbar from './toolbar/Toolbar.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useContentStore } from '../../store/contentStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { getBlockContentLabel } from '../../utils/helpers.js';
import { useOptionalSearchParams } from '../../utils/router.js';

const EMPTY_SLIDES = [];

/**
 * Блок «Теория»: тулбар, слайд с сеткой контента и боковое содержание.
 * В режиме просмотра (uiMode !== 'edit') редактор скрыт, контент только читается.
 */
export default function TheoryBlock({ block }) {
  const isEditor = useAuthStore((state) => state.isEditor);
  const uiMode = useUiStore((state) => state.uiMode);
  const canEdit = isEditor && uiMode === 'edit';

  const storeBlockId = useContentStore((state) => state.blockId);
  const allSlides = useContentStore((state) => state.slides);
  const activeSlideId = useContentStore((state) => state.activeSlideId);
  const loading = useContentStore((state) => state.loading);
  const loaded = useContentStore((state) => state.loaded);
  const error = useContentStore((state) => state.error);
  const fetchSlides = useContentStore((state) => state.fetchSlides);
  const setActiveSlide = useContentStore((state) => state.setActiveSlide);
  const addSlide = useContentStore((state) => state.addSlide);
  const updateSlide = useContentStore((state) => state.updateSlide);
  const deleteSlide = useContentStore((state) => state.deleteSlide);
  const reorderSlides = useContentStore((state) => state.reorderSlides);
  const addContent = useContentStore((state) => state.addContent);
  const updateContent = useContentStore((state) => state.updateContent);
  const deleteContent = useContentStore((state) => state.deleteContent);
  const reorderContents = useContentStore((state) => state.reorderContents);

  const sameBlock = storeBlockId === block.id;
  const slides = sameBlock ? allSlides : EMPTY_SLIDES;
  const activeIndex = slides.findIndex((slide) => slide.id === activeSlideId);
  const activeSlide = activeIndex >= 0 ? slides[activeIndex] : slides[0] ?? null;
  const showSkeleton = slides.length === 0 && (loading || !sameBlock);
  const showEmpty = sameBlock && loaded && !loading && slides.length === 0 && !error;

  const [editorInstance, setEditorInstance] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const titleTimer = useRef(null);

  // Шаг 17: поиск по документу — панель, подсветка найденного фрагмента
  // и отложенная прокрутка к нему после переключения слайда.
  const [searchOpen, setSearchOpen] = useState(false);
  const [foundContentId, setFoundContentId] = useState(null);
  const pendingScroll = useRef(null);

  // Внутренняя ссылка (Правка 6): переход по курсу и ?slide=<id> в адресе.
  // Параметр применяем один раз: иначе «Далее» будет возвращать на слайд-цель.
  const searchParams = useOptionalSearchParams();
  const onInternalLink = useInternalLink();
  const targetSlideId = searchParams.get('slide');
  const handledSlide = useRef(null);

  useEffect(() => {
    if (!targetSlideId || handledSlide.current === targetSlideId) return;
    if (!slides.some((slide) => slide.id === targetSlideId)) return;

    handledSlide.current = targetSlideId;
    setActiveSlide(targetSlideId);
  }, [targetSlideId, slides, setActiveSlide]);

  useEffect(() => {
    fetchSlides(block.id);
  }, [block.id, fetchSlides]);

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

  // После переключения слайда прокручиваем к найденному фрагменту:
  // карточки нового слайда появляются только на следующем кадре.
  useEffect(() => {
    if (!pendingScroll.current) return undefined;

    const timer = setTimeout(() => {
      const contentId = pendingScroll.current;
      pendingScroll.current = null;
      document.querySelector(`[data-content-id="${contentId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    return () => clearTimeout(timer);
  }, [activeSlide?.id]);

  useEffect(() => {
    setTitleDraft(activeSlide?.title ?? '');
  }, [activeSlide?.id, activeSlide?.title]);

  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    [],
  );

  // Клик или Enter по результату поиска: открыть слайд и подсветить фрагмент.
  const handleSearchSelect = (result) => {
    const target = result.contentId ? document.querySelector(`[data-content-id="${result.contentId}"]`) : null;

    if (result.slideId === activeSlide?.id) {
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      pendingScroll.current = result.contentId;
      setActiveSlide(result.slideId);
    }

    setFoundContentId(result.contentId);
  };

  const handleTitleChange = (value) => {
    setTitleDraft(value);

    if (!activeSlide) return;
    if (titleTimer.current) clearTimeout(titleTimer.current);

    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      updateSlide(activeSlide.id, value);
    }, 700);
  };

  const handleAddSlide = async () => {
    const result = await addSlide(block.id);
    if (!result.ok) setActionError(result.message);
  };

  const handleDeleteSlide = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    const result = await deleteSlide(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!result.ok) setActionError(result.message);
  };

  const moveSlide = async (index, direction) => {
    const next = index + direction;
    if (next < 0 || next >= slides.length) return;

    const ids = slides.map((slide) => slide.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];

    const result = await reorderSlides(block.id, ids);
    if (!result.ok) setActionError(result.message);
  };

  const handleAddContent = async (type, index) => {
    if (!activeSlide) return;

    const result = await addContent(activeSlide.id, type);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    const slide = useContentStore.getState().slides.find((item) => item.id === activeSlide.id);
    const ids = (slide?.contents ?? []).map((content) => content.id);
    const currentIndex = ids.indexOf(result.content.id);

    if (index !== null && index !== undefined && currentIndex !== index && index < ids.length - 1) {
      ids.splice(currentIndex, 1);
      ids.splice(index, 0, result.content.id);
      await reorderContents(activeSlide.id, ids);
    }
  };

  const handleSaveContent = useCallback(
    (contentId, data) => (activeSlide ? updateContent(activeSlide.id, contentId, { data }) : null),
    [activeSlide, updateContent],
  );

  const handleDeleteContent = (contentId) => {
    if (!activeSlide) return;
    deleteContent(activeSlide.id, contentId).then((result) => {
      if (!result.ok) setActionError(result.message);
    });
  };

  const handleWidthChange = (contentId, width) => {
    if (!activeSlide) return;
    updateContent(activeSlide.id, contentId, { width }).then((result) => {
      if (!result.ok) setActionError(result.message);
    });
  };

  const handleReorder = (orderedIds) => {
    if (!activeSlide) return;
    reorderContents(activeSlide.id, orderedIds).then((result) => {
      if (!result.ok) setActionError(result.message);
    });
  };

  const toolbarEditor = useMemo(
    () => (editorInstance && !editorInstance.isDestroyed ? editorInstance : null),
    [editorInstance],
  );

  return (
    <section className="theory">
      {canEdit && <Toolbar editor={toolbarEditor} onAddContent={(type) => handleAddContent(type, null)} />}

      {slides.length > 0 &&
        (searchOpen ? (
          <DocumentSearch
            slides={slides}
            activeSlideId={activeSlide?.id ?? null}
            onSelect={handleSearchSelect}
            onClose={() => setSearchOpen(false)}
          />
        ) : (
          <div className="theory__search-row">
            <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={16} />
              Поиск по документу
            </Button>
            <span className="theory__search-hint">Ctrl + F</span>
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

      <div className="theory__layout">
        <div className="theory__main">
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
              <Icon name="file" size={32} />
              <p className="empty-state__title">В блоке пока нет слайдов</p>
              {canEdit ? (
                <>
                  <p>Слайд — это страница теории: текст, картинки, видео и таблицы.</p>
                  <Button size="sm" onClick={handleAddSlide}>
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
              <div className="slide-head">
                <span className="slide-head__index">Слайд {activeIndex + 1}</span>

                {canEdit ? (
                  <input
                    className="input slide-head__title"
                    value={titleDraft}
                    placeholder="Название слайда"
                    aria-label="Название слайда"
                    onChange={(event) => handleTitleChange(event.target.value)}
                  />
                ) : (
                  <h2 className="slide-head__title">{activeSlide.title || `Слайд ${activeIndex + 1}`}</h2>
                )}
              </div>

              <SlideGrid
                slide={activeSlide}
                canEdit={canEdit}
                checklistBlockId={canEdit ? null : block.id}
                highlightContentId={foundContentId}
                onAddContent={handleAddContent}
                onSaveContent={handleSaveContent}
                onDeleteContent={handleDeleteContent}
                onWidthChange={handleWidthChange}
                onReorder={handleReorder}
                onActivateEditor={setEditorInstance}
                onLinkClick={onInternalLink}
              />

              <Navigation
                index={activeIndex}
                total={slides.length}
                onPrev={() => setActiveSlide(slides[activeIndex - 1].id)}
                onNext={() => setActiveSlide(slides[activeIndex + 1].id)}
              />
            </>
          )}
        </div>

        <aside className="theory__side" aria-label="Содержание">
          <div className="theory__side-head">
            <h2 className="theory__side-title">Содержание</h2>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={handleAddSlide} title="Добавить слайд">
                <Icon name="plus" size={16} />
              </Button>
            )}
          </div>

          {slides.length === 0 ? (
            <p className="theory__side-empty">Слайдов пока нет</p>
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
                    <span className="slide-list__count">{slide.contentCount ?? slide.contents?.length ?? 0}</span>
                  </button>

                  {canEdit && (
                    <span className="slide-list__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Переместить выше"
                        disabled={index === 0}
                        onClick={() => moveSlide(index, -1)}
                      >
                        <Icon name="chevronUp" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Переместить ниже"
                        disabled={index === slides.length - 1}
                        onClick={() => moveSlide(index, 1)}
                      >
                        <Icon name="chevronDown" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label="Удалить слайд"
                        onClick={() => setPendingDelete(slide)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="theory__side-hint">{getBlockContentLabel('theory', slides.length)}</p>
        </aside>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Удалить слайд?"
          message={
            <>
              <p className="modal__text">
                Слайд «{pendingDelete.title || 'Без названия'}» будет удалён вместе с контентом.
              </p>
              <p className="modal__text modal__text--muted">Действие нельзя отменить.</p>
            </>
          }
          loading={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDeleteSlide}
        />
      )}
    </section>
  );
}
