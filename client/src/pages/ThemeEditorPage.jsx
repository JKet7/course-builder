import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import ConfirmModal from '../components/ui/ConfirmModal.jsx';
import Icon from '../components/ui/Icon.jsx';
import ThemeCard from '../components/theme/ThemeCard.jsx';
import ThemeEditor from '../components/theme/ThemeEditor.jsx';
import { useAuthStore } from '../store/authStore.js';
import { useThemeStore } from '../store/themeStore.js';
import { copyThemeName, draftFromTheme } from '../utils/themes.js';

/**
 * Страница тем (Шаг 12): список глобальных и личных тем, выбор активной,
 * создание/правка/копирование/удаление и живой предпросмотр.
 */
export default function ThemeEditorPage() {
  const themes = useThemeStore((state) => state.themes);
  const loaded = useThemeStore((state) => state.loaded);
  const loading = useThemeStore((state) => state.loading);
  const error = useThemeStore((state) => state.error);
  const saving = useThemeStore((state) => state.saving);
  const fetchThemes = useThemeStore((state) => state.fetchThemes);
  const setActive = useThemeStore((state) => state.setActive);
  const createTheme = useThemeStore((state) => state.createTheme);
  const updateTheme = useThemeStore((state) => state.updateTheme);
  const deleteTheme = useThemeStore((state) => state.deleteTheme);

  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');

  const [editing, setEditing] = useState(null); // { id: string | null, draft }
  const [editingSaving, setEditingSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [applyingId, setApplyingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Страница может открыться первой после перезагрузки — тогда темы грузим здесь
  useEffect(() => {
    if (!loaded && !loading) fetchThemes();
  }, [loaded, loading, fetchThemes]);

  const closeEditor = () => {
    setEditing(null);
    setFieldErrors(null);
  };

  /** Пустая форма или копия существующей темы */
  const startCreate = (source = null) => {
    setActionError(null);
    setFieldErrors(null);
    setEditing({
      id: null,
      draft: source
        ? { ...draftFromTheme(source), name: copyThemeName(source.name), isGlobal: false }
        : draftFromTheme(null),
    });
  };

  const startEdit = (theme) => {
    setActionError(null);
    setFieldErrors(null);
    setEditing({ id: theme.id, draft: draftFromTheme(theme) });
  };

  const handleSubmit = async (draft) => {
    setEditingSaving(true);
    setActionError(null);

    const payload = { name: draft.name, colors: draft.colors };
    const result = editing.id
      ? await updateTheme(editing.id, payload)
      : await createTheme({ ...payload, isGlobal: isAdmin && draft.isGlobal });

    setEditingSaving(false);

    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? null);
      if (!result.fieldErrors) setActionError(result.message);
      return;
    }

    setEditing(null);
    setFieldErrors(null);
  };

  const handleApply = async (theme) => {
    if (theme.isActive) return;

    setApplyingId(theme.id);
    setActionError(null);
    const result = await setActive(theme.id);
    setApplyingId(null);

    if (!result.ok) setActionError(result.message);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    setDeleteError(null);
    const result = await deleteTheme(pendingDelete.id);
    setDeleting(false);

    if (!result.ok) {
      setDeleteError(result.message);
      return;
    }

    if (editing?.id === pendingDelete.id) setEditing(null);
    setPendingDelete(null);
  };

  const skeleton = (
    <div className="theme-grid">
      {[0, 1, 2].map((index) => (
        <div key={index} className="theme-card theme-card--skeleton" />
      ))}
    </div>
  );

  return (
    <section className="page themes-page">
      <nav className="breadcrumbs">
        <Link to="/">Курсы</Link>
        <span aria-hidden="true">/</span>
        <span>Темы</span>
      </nav>

      <div className="page__head">
        <div>
          <h1 className="page__title">Темы оформления</h1>
          <p className="page__hint">
            {isAdmin
              ? 'Глобальные темы видны всем, личные — только автору. Администратор может править любую тему.'
              : 'Личная тема меняет оформление только для вас, глобальные настраивает администратор.'}
          </p>
        </div>

        <div className="page__actions">
          <Button onClick={() => startCreate()}>
            <Icon name="plus" size={16} />
            Новая тема
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{error}</span>
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => fetchThemes()}>
            <Icon name="refresh" size={14} />
            Повторить
          </Button>
        </div>
      )}

      {actionError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{actionError}</span>
        </div>
      )}

      {editing && (
        <ThemeEditor
          key={editing.id ?? 'new'}
          mode={editing.id ? 'edit' : 'create'}
          initial={editing.draft}
          canToggleGlobal={isAdmin}
          saving={editingSaving}
          serverErrors={fieldErrors}
          onSubmit={handleSubmit}
          onCancel={closeEditor}
        />
      )}

      {!loaded ? (
        skeleton
      ) : themes.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">Тем пока нет</p>
          <p>{error ? 'Список не загрузился — попробуйте ещё раз.' : 'Создайте личную тему — она появится в списке.'}</p>
        </div>
      ) : (
        <div className="theme-grid">
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              applying={applyingId === theme.id && saving}
              onApply={handleApply}
              onEdit={startEdit}
              onCopy={startCreate}
              onDelete={(item) => {
                setDeleteError(null);
                setPendingDelete(item);
              }}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Удалить тему?"
          message={
            <>
              <p className="modal__text">Тема «{pendingDelete.name}» будет удалена без возможности восстановления.</p>
              {pendingDelete.isActive && (
                <p className="modal__text modal__text--muted">
                  Она сейчас активна — оформление вернётся к теме по умолчанию.
                </p>
              )}
            </>
          }
          confirmLabel="Удалить"
          loading={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (deleting) return;
            setPendingDelete(null);
            setDeleteError(null);
          }}
        />
      )}
    </section>
  );
}

