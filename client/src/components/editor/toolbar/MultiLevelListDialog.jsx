import { useState } from 'react';
import Button from '../../ui/Button.jsx';
import Modal from '../../ui/Modal.jsx';
import {
  DEFAULT_LIST_LEVELS,
  LIST_BULLET_MARKERS,
  LIST_NUMBER_STYLES,
  LIST_SUFFIXES,
  normalizeListLevels,
} from '../../../utils/listNumbering.js';
import { applyListLevels, getCurrentListLevels, getRootListAtSelection } from '../extensions/multiLevelList.js';

/** Строка настройки одного уровня списка. */
function LevelRow({ index, level, onChange }) {
  const patch = (values) => onChange(index, values);
  const isBullet = level.kind === 'bullet';

  return (
    <div className="list-levels__row">
      <span className="list-levels__name">Уровень {index + 1}</span>

      <select
        className="tool-select"
        aria-label={`Тип уровня ${index + 1}`}
        value={level.kind}
        onChange={(event) => patch({ kind: event.target.value })}
      >
        <option value="ordered">Нумерованный</option>
        <option value="bullet">Маркированный</option>
      </select>

      {isBullet ? (
        <select
          className="tool-select"
          aria-label={`Символ маркера уровня ${index + 1}`}
          value={level.marker}
          onChange={(event) => patch({ marker: event.target.value })}
        >
          {LIST_BULLET_MARKERS.map((marker) => (
            <option key={marker} value={marker}>
              {marker}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="tool-select"
          aria-label={`Формат номера уровня ${index + 1}`}
          value={level.style}
          onChange={(event) => patch({ style: event.target.value })}
        >
          {LIST_NUMBER_STYLES.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
      )}

      <input
        className="input"
        aria-label={`Шаблон номера уровня ${index + 1}`}
        value={isBullet ? '' : level.template}
        placeholder="%1.%2"
        disabled={isBullet}
        onChange={(event) => patch({ template: event.target.value })}
      />

      <select
        className="tool-select"
        aria-label={`Суффикс уровня ${index + 1}`}
        value={level.suffix}
        disabled={isBullet}
        onChange={(event) => patch({ suffix: event.target.value })}
      >
        {LIST_SUFFIXES.map((suffix) => (
          <option key={suffix.label} value={suffix.value}>
            {suffix.label}
          </option>
        ))}
      </select>

      <input
        className="input"
        type="number"
        min="0.8"
        max="6"
        step="0.1"
        aria-label={`Отступ уровня ${index + 1}`}
        value={level.indent}
        onChange={(event) => patch({ indent: event.target.value })}
      />

      <input
        className="input"
        type="number"
        min="1"
        max="999"
        aria-label={`Начальный номер уровня ${index + 1}`}
        value={level.start}
        disabled={isBullet}
        onChange={(event) => patch({ start: event.target.value })}
      />
    </div>
  );
}

/**
 * Окно настройки многоуровневого списка (Правка 4).
 * Настройки хранятся в самом списке (атрибуты levels/listId),
 * поэтому у каждого списка может быть свой формат уровней.
 */
export default function MultiLevelListDialog({ editor, onClose }) {
  const [levels, setLevels] = useState(() => getCurrentListLevels(editor));
  const [error, setError] = useState('');
  // Настройки применяются к списку, в котором стоит курсор
  const inList = Boolean(getRootListAtSelection(editor));

  const patchLevel = (index, values) =>
    setLevels((current) => current.map((level, item) => (item === index ? { ...level, ...values } : level)));

  const handleApply = () => {
    if (!applyListLevels(editor, levels)) {
      setError('Поставьте курсор в список, который нужно настроить');
      return;
    }

    onClose();
  };

  return (
    <Modal
      title="Многоуровневый список"
      subtitle="До 9 уровней: маркер или номер, формат, отступ и начальный номер."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            className="list-levels__reset"
            onClick={() => setLevels(normalizeListLevels(DEFAULT_LIST_LEVELS))}
          >
            По умолчанию
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleApply} disabled={!inList}>
            Применить
          </Button>
        </>
      }
    >
      {!inList && (
        <p className="list-levels__hint list-levels__hint--top">
          Поставьте курсор в список — настройки применяются именно к нему. Новый список создают кнопки «Маркированный
          список» и «Нумерованный список» на панели инструментов.
        </p>
      )}

      <div className="list-levels">
        <div className="list-levels__row list-levels__row--head" aria-hidden="true">
          <span>Уровень</span>
          <span>Тип</span>
          <span>Формат</span>
          <span>Шаблон</span>
          <span>Суффикс</span>
          <span>Отступ</span>
          <span>Старт</span>
        </div>

        {levels.map((level, index) => (
          <LevelRow key={index} index={index} level={level} onChange={patchLevel} />
        ))}
      </div>

      <p className="list-levels__hint">
        В шаблоне %1 … %9 — номера соответствующих уровней: «%1.%2» на втором уровне даёт 1.1, а «%3» с суффиксом «)» — 1).
        Счётчик уровня сбрасывается, когда выше появляется новый пункт, поэтому номера пересчитываются автоматически.
      </p>

      {error && <p className="field__error">{error}</p>}
    </Modal>
  );
}

