import { useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';

/** Тумблеры теста: перемешивание и ветвление. */
const TOGGLES = [
  {
    key: 'shuffleQuestions',
    label: 'Перемешивать вопросы',
    hint: 'Порядок вопросов у каждого читателя будет случайным',
  },
  {
    key: 'shuffleOptions',
    label: 'Перемешивать варианты',
    hint: 'Варианты ответа тоже показываются в случайном порядке',
  },
  {
    key: 'branching',
    label: 'Режим ветвления',
    hint: 'Дальнейший путь зависит от ответов: разделы, переходы и итоги',
  },
];

/**
 * Панель базовых настроек режима редактора: тумблеры теста, группы,
 * разделы ветвления и импорт/экспорт CSV.
 */
export default function TestSettingsPanel({
  settings = {},
  groups = [],
  sections = [],
  counts = {},
  sectionsEnabled = false,
  onSettings,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onAddSection,
  onRenameSection,
  onDeleteSection,
  onExport,
  onImport,
  canExport = false,
}) {
  const [open, setOpen] = useState(true);
  const [newGroup, setNewGroup] = useState('');
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [groupDraft, setGroupDraft] = useState('');
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionDraft, setSectionDraft] = useState('');

  const handleAddGroup = (event) => {
    event.preventDefault();
    const name = newGroup.trim();
    if (!name) return;

    onAddGroup(name);
    setNewGroup('');
  };

  const startGroupEdit = (group) => {
    setEditingGroupId(group.id);
    setGroupDraft(group.name);
  };

  const commitGroupEdit = () => {
    const name = groupDraft.trim();
    if (editingGroupId && name) onRenameGroup(editingGroupId, name);
    setEditingGroupId(null);
  };

  const startSectionEdit = (section) => {
    setEditingSectionId(section.id);
    setSectionDraft(section.title);
  };

  const commitSectionEdit = () => {
    const title = sectionDraft.trim();
    if (editingSectionId && title) onRenameSection(editingSectionId, title);
    setEditingSectionId(null);
  };

  return (
    <section className="test-settings" aria-label="Настройки теста">
      <header className="test-settings__head">
        <button
          type="button"
          className="test-settings__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="settings" size={16} />
          <span className="test-settings__title">Настройки теста</span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>

        <div className="content-actions test-settings__csv">
          <Button variant="secondary" size="sm" onClick={onExport} disabled={!canExport}>
            <Icon name="download" size={16} />
            Экспорт CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={onImport}>
            <Icon name="upload" size={16} />
            Импорт CSV
          </Button>
        </div>
      </header>

      {open && (
        <div className="test-settings__body">
          <div className="test-settings__block">
            <div className="test-settings__block-head">
              <h3 className="test-settings__subtitle">Параметры прохождения</h3>
            </div>

            <div className="switch-list">
              {TOGGLES.map((item) => (
                <label className="switch" key={item.key}>
                  <input
                    type="checkbox"
                    className="switch__input"
                    checked={Boolean(settings[item.key])}
                    onChange={(event) => onSettings({ [item.key]: event.target.checked })}
                  />
                  <span className="switch__track" aria-hidden="true" />
                  <span className="switch__text">
                    <span className="switch__label">{item.label}</span>
                    <span className="switch__hint">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="test-settings__block">
            <div className="test-settings__block-head">
              <h3 className="test-settings__subtitle">Группы</h3>
              <span className="test-settings__count">{groups.length}</span>
            </div>

            <ul className="test-groups">
              {groups.map((group) => (
                <li className="test-group" key={group.id}>
                  {editingGroupId === group.id ? (
                    <input
                      className="input input--sm test-group__edit"
                      value={groupDraft}
                      autoFocus
                      aria-label="Название группы"
                      onChange={(event) => setGroupDraft(event.target.value)}
                      onBlur={commitGroupEdit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitGroupEdit();
                        }
                        if (event.key === 'Escape') setEditingGroupId(null);
                      }}
                    />
                  ) : (
                    <>
                      <Icon name="layers" size={14} />
                      <span className="test-group__name">{group.name}</span>
                      <span className="test-group__count">{counts[group.id] ?? 0}</span>
                    </>
                  )}

                  {editingGroupId !== group.id && (
                    <span className="test-group__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Переименовать группу «${group.name}»`}
                        onClick={() => startGroupEdit(group)}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`Удалить группу «${group.name}»`}
                        onClick={() => onDeleteGroup(group)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  )}
                </li>
              ))}

              {groups.length === 0 && <li className="test-group test-group--empty">Групп пока нет</li>}
            </ul>

            <form className="test-groups__add" onSubmit={handleAddGroup}>
              <input
                className="input input--sm"
                value={newGroup}
                placeholder="Новая группа"
                aria-label="Название новой группы"
                onChange={(event) => setNewGroup(event.target.value)}
              />
              <Button type="submit" variant="ghost" size="sm" aria-label="Добавить группу">
                <Icon name="plus" size={16} />
              </Button>
            </form>
          </div>

          {sectionsEnabled && (
            <div className="test-settings__block">
              <div className="test-settings__block-head">
                <h3 className="test-settings__subtitle">Разделы ветвления</h3>
                <span className="test-settings__count">{sections.length}</span>
              </div>

              <ul className="test-sections">
                {sections.map((section) => (
                  <li className="test-section-row" key={section.id}>
                    {editingSectionId === section.id ? (
                      <input
                        className="input input--sm"
                        value={sectionDraft}
                        autoFocus
                        aria-label="Название раздела"
                        onChange={(event) => setSectionDraft(event.target.value)}
                        onBlur={commitSectionEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitSectionEdit();
                          }
                          if (event.key === 'Escape') setEditingSectionId(null);
                        }}
                      />
                    ) : (
                      <span className="test-section-row__name">{section.title}</span>
                    )}

                    <span className="test-section-row__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Переименовать раздел «${section.title}»`}
                        onClick={() => startSectionEdit(section)}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`Удалить раздел «${section.title}»`}
                        onClick={() => onDeleteSection(section)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  </li>
                ))}

                {sections.length === 0 && (
                  <li className="test-section-row test-section-row--empty">
                    Раздел — точка ветвления: к нему ведут переходы вариантов ответа.
                  </li>
                )}
              </ul>

              <Button variant="ghost" size="sm" onClick={() => onAddSection(null)}>
                <Icon name="plus" size={14} />
                Добавить раздел
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
