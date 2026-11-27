import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { QUESTION_TYPES } from '../../utils/helpers.js';
import { optionTargetValue } from '../../utils/testEditor.js';

/**
 * Правая панель настроек вопроса (Context Panel) режима редактора.
 * Выезжает поверх списка при выборе карточки: тип, группа, раздел,
 * логика перехода по вариантам ответа и действия «Дублировать» / «Удалить».
 */
export default function QuestionSettingsPanel({
  question,
  draft,
  groups = [],
  sections = [],
  settings = {},
  onTypeChange,
  onGroupChange,
  onSectionChange,
  onTargetChange,
  onDuplicate,
  onDelete,
  onClose,
}) {
  const withOptions = draft.type === 'single' || draft.type === 'multiple';
  const options = withOptions ? draft.options : [];

  // Раздел могли удалить: такой переход показываем как «следующий вопрос».
  const knownSections = new Set(sections.map((section) => section.id));
  const targetValue = (option) => {
    const value = optionTargetValue(option);
    return value.startsWith('section:') && !knownSections.has(value.slice('section:'.length)) ? 'next' : value;
  };

  return (
    <aside
      className="question-settings"
      aria-label="Настройки вопроса"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="question-settings__head">
        <h2 className="question-settings__title">Настройки вопроса</h2>
        <button type="button" className="icon-btn" aria-label="Закрыть настройки вопроса" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </header>

      <label className="content-field">
        <span className="content-field__label">Тип вопроса</span>
        <select className="tool-select" value={draft.type} onChange={(event) => onTypeChange(event.target.value)}>
          {QUESTION_TYPES.map((item) => (
            <option key={item.type} value={item.type}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="content-field">
        <span className="content-field__label">Группа</span>
        <select
          className="tool-select"
          value={draft.groupId ?? ''}
          onChange={(event) => onGroupChange(event.target.value || null)}
        >
          <option value="">Без группы</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>

      {sections.length > 0 && (
        <label className="content-field">
          <span className="content-field__label">Раздел</span>
          <select
            className="tool-select"
            value={question.sectionId ?? ''}
            onChange={(event) => onSectionChange(event.target.value || null)}
          >
            <option value="">Без раздела</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {settings.branching ? (
        withOptions ? (
          <div className="question-settings__branch">
            <span className="content-field__label">Логика перехода</span>
            <p className="question-settings__hint">Куда ведёт читателя каждый вариант ответа.</p>

            <ul className="branch-list">
              {options.map((option, index) => (
                <li className="branch-row" key={index}>
                  <span className="branch-row__text" title={option.text}>
                    {option.text.trim() || `Вариант ${index + 1}`}
                  </span>

                  <select
                    className="tool-select"
                    aria-label={`Переход для варианта ${index + 1}`}
                    value={targetValue(option)}
                    onChange={(event) => onTargetChange(index, event.target.value)}
                  >
                    <option value="next">Перейти к следующему вопросу</option>
                    <option value="submit">Отправить форму</option>
                    {sections.map((section) => (
                      <option key={section.id} value={`section:${section.id}`}>
                        Перейти к разделу «{section.title}»
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="question-settings__hint">
            Логика перехода настраивается для вопросов с вариантами ответа.
          </p>
        )
      ) : (
        <p className="question-settings__hint">
          Включите «Режим ветвления» в настройках теста, чтобы задать переходы.
        </p>
      )}

      <div className="question-settings__actions">
        <Button variant="secondary" size="sm" onClick={onDuplicate}>
          <Icon name="copy" size={15} />
          Дублировать
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Icon name="trash" size={15} />
          Удалить
        </Button>
      </div>
    </aside>
  );
}
