import { useEffect, useRef, useState } from 'react';
import CourseGrid from '../components/course/CourseGrid.jsx';
import Button from '../components/ui/Button.jsx';
import Icon from '../components/ui/Icon.jsx';
import { downloadCourseArchive } from '../api/courseExport.js';
import { useAuthStore } from '../store/authStore.js';
import { useCourseStore } from '../store/courseStore.js';
import { useUiStore } from '../store/uiStore.js';

function CourseGridSkeleton() {
  return (
    <div className="course-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="course-card skeleton-card">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--line skeleton--short" />
          <span className="skeleton skeleton--footer" />
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const courses = useCourseStore((state) => state.courses);
  const loading = useCourseStore((state) => state.loading);
  const error = useCourseStore((state) => state.error);
  const loaded = useCourseStore((state) => state.loaded);
  const fetchCourses = useCourseStore((state) => state.fetchCourses);
  const importCourse = useCourseStore((state) => state.importCourse);
  const openModal = useUiStore((state) => state.openModal);
  const isEditor = useAuthStore((state) => state.isEditor);

  const archiveInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importNotice, setImportNotice] = useState(null);
  const [exportingId, setExportingId] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);
  const [printError, setPrintError] = useState(null);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  /** Импорт курса из ZIP: ошибка показывается на странице, успех — счётчиками. */
  const handleArchive = async (file) => {
    if (!file || importing) return;

    setImporting(true);
    setImportError(null);
    setImportNotice(null);

    const result = await importCourse(file);
    setImporting(false);

    if (!result.ok) {
      setImportError(result.message);
      return;
    }

    const { stats } = result;
    setImportNotice(
      `Курс «${result.course.title}» импортирован: блоков — ${stats.blocks}, слайдов — ${stats.slides}, ` +
        `вопросов — ${stats.questions}, картинок — ${stats.files}.`,
    );
  };

  /** Экспорт курса в ZIP (Шаг 14): браузер сохраняет файл, страница меняет только алерты. */
  const handleExport = async (course) => {
    if (!course || exportingId) return;

    setExportingId(course.id);
    setExportError(null);
    setExportNotice(null);

    const result = await downloadCourseArchive(course);
    setExportingId(null);

    if (!result.ok) {
      setExportError(result.message);
      return;
    }

    setExportNotice(`Архив курса «${course.title}» сохранён: ${result.filename}.`);
  };

  /**
   * Печать курса (Шаг 15): документ открывается в новой вкладке, где сразу
   * вызывается диалог печати — оттуда браузер сохраняет PDF.
   */
  const handlePrint = (course) => {
    if (!course) return;

    setPrintError(null);
    const opened = window.open(`/course/${course.id}/print?print=1`, '_blank', 'noopener');

    if (!opened) {
      setPrintError('Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.');
    }
  };

  const isEmpty = loaded && !loading && courses.length === 0;

  return (
    <section className="page">
      <div className="page__head">
        <h1 className="page__title">Курсы</h1>
        {loaded && !loading && <span className="page__counter">{courses.length}</span>}

        <div className="page__actions">
          {isEditor && (
            <>
              <input
                ref={archiveInputRef}
                type="file"
                accept=".zip,application/zip"
                className="visually-hidden"
                tabIndex={-1}
                onChange={(event) => {
                  handleArchive(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => archiveInputRef.current?.click()}
                disabled={importing}
              >
                <Icon name={importing ? 'loader' : 'upload'} size={16} className={importing ? 'icon--spin' : undefined} />
                {importing ? 'Импортируем…' : 'Импорт ZIP'}
              </Button>
            </>
          )}

          <Button variant="ghost" size="sm" onClick={() => fetchCourses()} disabled={loading}>
            <Icon name="refresh" size={16} />
            Обновить
          </Button>
        </div>
      </div>

      {loading && courses.length === 0 && <CourseGridSkeleton />}

      {error && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => fetchCourses()}>
            Повторить
          </Button>
        </div>
      )}

      {importError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">Импорт не выполнен: {importError}</span>
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
          <span className="alert__text">Экспорт не выполнен: {exportError}</span>
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

      {printError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">Печать не открылась: {printError}</span>
          <Button variant="ghost" size="sm" onClick={() => setPrintError(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {isEmpty && !isEditor && (
        <div className="empty-state empty-state--center">
          <Icon name="book" size={32} />
          <p className="empty-state__title">Курсов пока нет</p>
          <p>Как только администратор добавит курсы, они появятся здесь.</p>
        </div>
      )}

      {isEditor && (
        <CourseGrid
          courses={courses}
          onAdd={() => openModal('course-create')}
          onEdit={(course) => openModal('course-edit', course)}
          onDelete={(course) => openModal('course-delete', course)}
          onExport={(course) => handleExport(course)}
          onPrint={(course) => handlePrint(course)}
        />
      )}

      {!isEditor && courses.length > 0 && <CourseGrid courses={courses} />}
    </section>
  );
}
