import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BlockList from '../components/block/BlockList.jsx';
import BlockPreview from '../components/block/BlockPreview.jsx';
import ModeToggle from '../components/layout/ModeToggle.jsx';
import Button from '../components/ui/Button.jsx';
import Icon from '../components/ui/Icon.jsx';
import Menu from '../components/ui/Menu.jsx';
import { downloadBlockFile } from '../api/blockTransfer.js';
import { downloadCourseArchive } from '../api/courseExport.js';
import { useAuthStore } from '../store/authStore.js';
import { useBlockStore } from '../store/blockStore.js';
import { useCourseStore } from '../store/courseStore.js';
import { useUiStore } from '../store/uiStore.js';
import { hasChecklistProgress, resetChecklistProgress } from '../utils/checklistProgress.js';

const EMPTY_BLOCKS = [];

/** Файл блока: JSON-манифест или ZIP с course.json. */
const BLOCK_FILE_ACCEPT = '.json,.zip,application/json,application/zip';

function CourseSkeleton() {
  return (
    <div className="course-layout" aria-hidden="true">
      <div className="course-blocks">
        {[0, 1, 2].map((index) => (
          <div key={index} className="block-item skeleton-card">
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--line skeleton--short" />
          </div>
        ))}
      </div>

      <div className="block-preview skeleton-preview">
        <span className="skeleton skeleton--line" />
      </div>
    </div>
  );
}

/**
 * Страница курса: список блоков слева (поиск, карточки, «Добавить блок»)
 * и превью выбранного блока справа. Режим редактора добавляет меню курса,
 * меню блока ⋮ и загрузку блоков.
 */
export default function CoursePage() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const course = useCourseStore((state) => state.currentCourse);
  const courseLoading = useCourseStore((state) => state.courseLoading);
  const courseError = useCourseStore((state) => state.courseError);
  const courseNotFound = useCourseStore((state) => state.courseNotFound);
  const fetchCourse = useCourseStore((state) => state.fetchCourse);

  const storeCourseId = useBlockStore((state) => state.courseId);
  const allBlocks = useBlockStore((state) => state.blocks);
  const blocksLoading = useBlockStore((state) => state.loading);
  const blocksLoaded = useBlockStore((state) => state.loaded);
  const blocksError = useBlockStore((state) => state.error);
  const fetchBlocks = useBlockStore((state) => state.fetchBlocks);
  const importBlock = useBlockStore((state) => state.importBlock);
  const duplicateBlock = useBlockStore((state) => state.duplicateBlock);

  const openModal = useUiStore((state) => state.openModal);
  const isEditor = useAuthStore((state) => state.isEditor);

  const blockFileRef = useRef(null);
  const [previewId, setPreviewId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importNotice, setImportNotice] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);
  const [checklistRevision, setChecklistRevision] = useState(0);

  // Блоки другого курса не показываем, пока не загрузились свои
  const sameCourse = storeCourseId === courseId;
  const blocks = sameCourse ? allBlocks : EMPTY_BLOCKS;
  const loaded = sameCourse && blocksLoaded;
  const loading = courseLoading || (blocksLoading && !loaded);
  const preview = blocks.find((block) => block.id === previewId) ?? blocks[0] ?? null;

  // Правка 10: отметки чек-листов живут в localStorage этого браузера.
  // Revision пересчитывает карточки после кнопки «Сначала».
  const blockCards = useMemo(
    () =>
      blocks.map((block) => ({
        ...block,
        checklistProgress: hasChecklistProgress(block.id),
      })),
    [blocks, checklistRevision],
  );

  useEffect(() => {
    fetchCourse(courseId);
    fetchBlocks(courseId);
  }, [courseId, fetchCourse, fetchBlocks]);

  // При переходе на другой курс превью начинается с первого блока,
  // а сообщения о переносе файлов больше не относятся к новому курсу.
  useEffect(() => {
    setPreviewId(null);
    setImportError(null);
    setImportNotice(null);
    setExportError(null);
    setExportNotice(null);
  }, [courseId]);

  const reload = () => {
    fetchCourse(courseId);
    fetchBlocks(courseId);
  };

  /** «Сначала»: сбрасывает отметки чек-листов блока в этом браузере. */
  const handleResetChecklist = (block) => {
    if (!block) return;
    resetChecklistProgress(block.id);
    setChecklistRevision((revision) => revision + 1);
  };

  /** «Загрузить блок»: файл блока (JSON/ZIP) добавляется в конец курса. */
  const handleBlockFile = async (file) => {
    if (!file || importing) return;

    setImporting(true);
    setImportError(null);
    setImportNotice(null);

    const result = await importBlock(courseId, file);
    setImporting(false);

    if (!result.ok) {
      setImportError(result.message);
      return;
    }

    setPreviewId(result.block.id);
    setImportNotice(`Блок «${result.block.title}» загружен в курс.`);
  };

  /** «Скачать блок»: JSON-манифест блока — его же понимает импорт. */
  const handleDownloadBlock = async (block) => {
    if (!block) return;

    setExportError(null);
    setExportNotice(null);

    const result = await downloadBlockFile(block);
    if (!result.ok) {
      setExportError(result.message);
      return;
    }

    setExportNotice(`Файл блока «${block.title}» сохранён: ${result.filename}.`);
  };

  /** «Дублировать»: копия блока встаёт в конец списка курса. */
  const handleDuplicate = async (block) => {
    if (!block) return;

    setExportError(null);
    setExportNotice(null);

    const result = await duplicateBlock(block.id);
    if (!result.ok) {
      setExportError(result.message);
      return;
    }

    setPreviewId(result.block.id);
    setExportNotice(`Блок «${block.title}» продублирован.`);
  };

  /** «Скачать курс»: ZIP-архив курса (Шаг 14). */
  const handleDownloadCourse = async () => {
    if (!course || exporting) return;

    setExporting(true);
    setExportError(null);
    setExportNotice(null);

    const result = await downloadCourseArchive(course);
    setExporting(false);

    if (!result.ok) {
      setExportError(result.message);
      return;
    }

    setExportNotice(`Архив курса «${course.title}» сохранён: ${result.filename}.`);
  };

  /** Меню «Настройки» — пять действий над курсом (только редактору). */
  const settingsItems = isEditor
    ? [
        {
          key: 'add',
          label: 'Добавить блок',
          icon: 'plus',
          onClick: () => openModal('block-create', { courseId }),
        },
        { key: 'upload', label: 'Загрузить блок', icon: 'upload', onClick: () => blockFileRef.current?.click() },
        {
          key: 'edit',
          label: 'Редактировать курс',
          icon: 'pencil',
          onClick: () => openModal('course-edit', course),
        },
        { key: 'download', label: 'Скачать курс', icon: 'download', onClick: handleDownloadCourse },
        { key: 'theme', label: 'Создать тему', icon: 'palette', onClick: () => navigate('/themes') },
      ]
    : [];

  const isEmpty = loaded && !blocksLoading && blocks.length === 0 && !courseNotFound;

  return (
    <section className="page page--course">
      <nav className="breadcrumbs">
        <Link to="/">Курсы</Link>
        <span aria-hidden="true">/</span>
        <span>{course?.title ?? (courseNotFound ? 'Курс не найден' : 'Курс')}</span>
      </nav>

      <div className="page__head course-head">
        <h1 className="page__title course-head__title">
          <Icon name="book" size={22} />
          {course?.title ?? (courseNotFound ? 'Курс не найден' : 'Загрузка…')}
        </h1>

        {course && loaded && !blocksLoading && <span className="page__counter">{blocks.length}</span>}

        <div className="page__actions course-head__actions">
          {isEditor && <ModeToggle />}

          {course && (
            <Link
              className="btn btn--ghost btn--sm"
              to={`/course/${courseId}/print`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="printer" size={16} />
              Печать / PDF
            </Link>
          )}

          <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
            <Icon name="refresh" size={16} />
            Обновить
          </Button>

          {isEditor && course && (
            <>
              <Menu label="Настройки курса" icon="settings" align="right" items={settingsItems} />

              <input
                ref={blockFileRef}
                type="file"
                accept={BLOCK_FILE_ACCEPT}
                className="visually-hidden"
                tabIndex={-1}
                onChange={(event) => {
                  handleBlockFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </>
          )}
        </div>
      </div>

      {course?.description && <p className="page__hint">{course.description}</p>}

      {courseNotFound && (
        <div className="empty-state empty-state--center">
          <Icon name="alert" size={32} />
          <p className="empty-state__title">Курс не найден</p>
          <p>Возможно, его удалили или ссылка устарела.</p>
          <Link to="/" className="btn btn--secondary btn--sm">
            <Icon name="arrowLeft" size={16} />
            К списку курсов
          </Link>
        </div>
      )}

      {courseError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{courseError}</span>
          <Button variant="ghost" size="sm" onClick={reload}>
            Повторить
          </Button>
        </div>
      )}

      {importing && (
        <div className="alert alert--info" role="status">
          <Icon name="loader" size={18} className="icon--spin" />
          <span className="alert__text">Загружаем блок…</span>
        </div>
      )}

      {importError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">Блок не загружен: {importError}</span>
          <Button variant="ghost" size="sm" onClick={() => setImportError(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {importNotice && (
        <div className="alert alert--success" role="status">
          <Icon name="check" size={18} />
          <span className="alert__text">{importNotice}</span>
          <Button variant="ghost" size="sm" onClick={() => setImportNotice(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {exportError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{exportError}</span>
          <Button variant="ghost" size="sm" onClick={() => setExportError(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {exportNotice && (
        <div className="alert alert--success" role="status">
          <Icon name="check" size={18} />
          <span className="alert__text">{exportNotice}</span>
          <Button variant="ghost" size="sm" onClick={() => setExportNotice(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {!courseNotFound && loading && blocks.length === 0 && <CourseSkeleton />}

      {blocksError && !blocksLoading && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{blocksError}</span>
          <Button variant="ghost" size="sm" onClick={() => fetchBlocks(courseId)}>
            Повторить
          </Button>
        </div>
      )}

      {isEmpty && !isEditor && (
        <div className="empty-state empty-state--center">
          <Icon name="layers" size={32} />
          <p className="empty-state__title">В курсе пока нет блоков</p>
          <p>Как только редактор добавит блоки, они появятся здесь.</p>
        </div>
      )}

      {!courseNotFound && (!isEmpty || isEditor) && !(loading && blocks.length === 0) && (
        <div className="course-layout">
          <aside className="course-layout__side" aria-label="Блоки курса">
            <BlockList
              blocks={blockCards}
              activeId={preview?.id ?? null}
              onSelect={(block) => setPreviewId(block.id)}
              onAdd={isEditor ? () => openModal('block-create', { courseId }) : undefined}
              onEdit={isEditor ? (block) => openModal('block-edit', block) : undefined}
              onDownload={isEditor ? handleDownloadBlock : undefined}
              onDuplicate={isEditor ? handleDuplicate : undefined}
              onDelete={isEditor ? (block) => openModal('block-delete', block) : undefined}
              onResetChecklist={handleResetChecklist}
            />
          </aside>

          <div className="course-layout__preview" aria-live="polite">
            <BlockPreview block={preview} />
          </div>
        </div>
      )}
    </section>
  );
}

