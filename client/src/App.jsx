import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Header from './components/layout/Header.jsx';
import BlockSettingsModal, { BlockDeleteModal } from './components/block/BlockSettingsModal.jsx';
import HelpModal from './components/block/HelpModal.jsx';
import CourseModal, { CourseDeleteModal } from './components/course/CourseModal.jsx';
import LinkDialog from './components/editor/toolbar/LinkDialog.jsx';
import BlockPage from './pages/BlockPage.jsx';
import CoursePage from './pages/CoursePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PrintCoursePage from './pages/PrintCoursePage.jsx';
import ThemeEditorPage from './pages/ThemeEditorPage.jsx';
import { useAuthStore } from './store/authStore.js';
import { useThemeStore } from './store/themeStore.js';
import { useUiStore } from './store/uiStore.js';

/** Оболочка для авторизованных страниц: проверка токена + Header. */
function ProtectedLayout() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

/** Единая точка рендера модалок: имя модалки хранится в uiStore. */
function ModalHost() {
  const modal = useUiStore((state) => state.modal);
  const closeModal = useUiStore((state) => state.closeModal);

  if (!modal) return null;

  switch (modal.name) {
    case 'course-create':
      return <CourseModal onClose={closeModal} />;
    case 'course-edit':
      return <CourseModal course={modal.payload} onClose={closeModal} />;
    case 'course-delete':
      return <CourseDeleteModal course={modal.payload} onClose={closeModal} />;
    case 'block-create':
      return <BlockSettingsModal courseId={modal.payload?.courseId} onClose={closeModal} />;
    case 'block-edit':
      return <BlockSettingsModal block={modal.payload} onClose={closeModal} />;
    case 'block-delete':
      return <BlockDeleteModal block={modal.payload} onClose={closeModal} />;
    case 'block-help':
      return <HelpModal block={modal.payload} onClose={closeModal} />;
    default:
      console.warn(`[ModalHost] неизвестная модалка: ${modal.name}`);
      return null;
  }
}

export default function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const restore = useAuthStore((state) => state.restore);
  const fetchThemes = useThemeStore((state) => state.fetchThemes);
  const resetThemes = useThemeStore((state) => state.reset);

  // Проверяем сохранённый токен при загрузке приложения и подтягиваем тему пользователя
  useEffect(() => {
    if (isAuthenticated) {
      restore();
      fetchThemes();
    } else {
      resetThemes();
    }
  }, [isAuthenticated, restore, fetchThemes, resetThemes]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Печать курса (Шаг 15): без Header и меню — документ на всю вкладку */}
        <Route path="/course/:courseId/print" element={<PrintCoursePage />} />

        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/course/:courseId" element={<CoursePage />} />
          <Route path="/block/:blockId" element={<BlockPage />} />
          <Route path="/themes" element={<ThemeEditorPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ModalHost />
      {/* Диалог ссылки (Правка 6) один на приложение: его открывают панель
          инструментов и иконка у поля обычного текста */}
      <LinkDialog />
    </>
  );
}
