import { lazy, Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import BlockBadge from '../components/block/BlockBadge.jsx';
import Button from '../components/ui/Button.jsx';
import Icon from '../components/ui/Icon.jsx';
import { useAuthStore } from '../store/authStore.js';
import { useBlockStore } from '../store/blockStore.js';
import { useLinkStore } from '../store/linkStore.js';
import { useUiStore } from '../store/uiStore.js';
import { getBlockContentLabel } from '../utils/helpers.js';

// Тяжёлые редакторы грузим по требованию (см. «Архитектура» п. 3.4)
const TheoryBlock = lazy(() => import('../components/editor/TheoryBlock.jsx'));
const TestBlock = lazy(() => import('../components/editor/TestBlock.jsx'));
const MemoBlock = lazy(() => import('../components/editor/MemoBlock.jsx'));
const GlossaryBlock = lazy(() => import('../components/editor/GlossaryBlock.jsx'));
const BlockPlaceholder = lazy(() => import('../components/block/BlockPlaceholder.jsx'));

/** Редактор по типу блока; неизвестный тип показывает заглушку. */
const BLOCK_EDITORS = {
  theory: TheoryBlock,
  test: TestBlock,
  memo: MemoBlock,
  glossary: GlossaryBlock,
};

function BlockSkeleton() {
  return (
    <div className="slide-skeleton" aria-hidden="true">
      <span className="skeleton skeleton--title" />
      <span className="skeleton skeleton--line" />
      <span className="skeleton skeleton--line" />
    </div>
  );
}

/** Страница блока: шапка с навигацией и редактор по типу блока. */
export default function BlockPage() {
  const { blockId } = useParams();

  const block = useBlockStore((state) => state.currentBlock);
  const loading = useBlockStore((state) => state.blockLoading);
  const error = useBlockStore((state) => state.blockError);
  const notFound = useBlockStore((state) => state.blockNotFound);
  const fetchBlock = useBlockStore((state) => state.fetchBlock);

  const isEditor = useAuthStore((state) => state.isEditor);
  const openModal = useUiStore((state) => state.openModal);
  const setLinkCourseId = useLinkStore((state) => state.setCourseId);

  useEffect(() => {
    fetchBlock(blockId);
  }, [blockId, fetchBlock]);

  // Курс нужен диалогу внутренних ссылок (Правка 6)
  const courseId = block?.course?.id ?? null;
  useEffect(() => {
    if (courseId) setLinkCourseId(courseId);
  }, [courseId, setLinkCourseId]);

  const current = block && block.id === blockId ? block : null;
  const missing = !current && !loading && !error;
  const Editor = current ? BLOCK_EDITORS[current.type] ?? BlockPlaceholder : null;

  return (
    <section className="page page--block">
      <nav className="breadcrumbs">
        <Link to="/">Курсы</Link>
        <span aria-hidden="true">/</span>

        {current?.course && (
          <>
            <Link to={`/course/${current.course.id}`}>{current.course.title}</Link>
            <span aria-hidden="true">/</span>
          </>
        )}

        <span>{current?.title ?? (notFound || missing ? 'Блок не найден' : 'Блок')}</span>
      </nav>

      <div className="page__head">
        <h1 className="page__title">{current?.title ?? (notFound || missing ? 'Блок не найден' : 'Загрузка…')}</h1>

        {current && (
          <div className="block-page__meta">
            <BlockBadge type={current.type} />
            <span className="block-page__count">{getBlockContentLabel(current.type, current.contentCount)}</span>
          </div>
        )}

        <div className="page__actions">
          {current?.course && (
            <Link className="btn btn--ghost btn--sm" to={`/course/${current.course.id}`}>
              <Icon name="arrowLeft" size={16} />
              К курсу
            </Link>
          )}

          {current && (
            <Button variant="ghost" size="sm" onClick={() => fetchBlock(blockId)} disabled={loading}>
              <Icon name="refresh" size={16} />
              Обновить
            </Button>
          )}

          {isEditor && current && (
            <Button variant="ghost" size="sm" onClick={() => openModal('block-delete', current)}>
              <Icon name="trash" size={16} />
              Удалить
            </Button>
          )}
        </div>
      </div>

      {current?.description && <p className="page__hint">{current.description}</p>}

      {(notFound || missing) && (
        <div className="empty-state empty-state--center">
          <Icon name="alert" size={32} />
          <p className="empty-state__title">Блок не найден</p>
          <p>Возможно, его удалили или ссылка устарела.</p>
          <Link to="/" className="btn btn--secondary btn--sm">
            <Icon name="arrowLeft" size={16} />
            К списку курсов
          </Link>
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => fetchBlock(blockId)}>
            Повторить
          </Button>
        </div>
      )}

      {loading && !current && <BlockSkeleton />}

      {current && (
        <Suspense fallback={<BlockSkeleton />}>
          <Editor block={current} />
        </Suspense>
      )}
    </section>
  );
}

