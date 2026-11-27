import { useEffect, useMemo, useRef, useState } from 'react';
import CellEditor from './CellEditor.jsx';
import EditorField, { EditorActions } from './EditorField.jsx';
import NoteTip, { useNoteTip } from '../NoteTip.jsx';
import ConfirmModal from '../../ui/ConfirmModal.jsx';
import Icon from '../../ui/Icon.jsx';
import { parseCsv } from '../../../utils/csv.js';
import { CONTENT_LIMITS } from '../../../utils/helpers.js';
import { collectNotes } from '../../../utils/notes.js';
import { DocContent } from '../ContentRenderer.jsx';
import {
  anchorOf,
  canMerge,
  canUnmerge,
  clearRect,
  hasTextOutsideAnchor,
  isCovered,
  isInRect,
  mergeAt,
  mergeRectCells,
  nextAnchor,
  nextInOrder,
  normalizeTableData,
  pasteMatrix,
  resizeTable,
  selectionRect,
  setCellDoc,
  tableToTsv,
  unmergeRectCells,
} from '../../../utils/table.js';

/** Пределы таблицы: те же, что проверяет сервер. */
const LIMITS = { columns: CONTENT_LIMITS.tableColumns, rows: CONTENT_LIMITS.tableRows };

/** Сколько показывать подсказку о буфере обмена. */
const NOTICE_TIMEOUT = 5000;

/** Одна и та же ячейка (объединённая — по верхней левой). */
const sameCell = (a, b) => Boolean(a && b) && a.row === b.row && a.col === b.col;

/**
 * Редактор таблицы.
 *
 * Ячейки — Tiptap-документы: клик по ячейке открывает в ней редактор, а панель
 * инструментов блока форматирует текст (жирный, курсив, цвет, размер, списки,
 * ссылки и примечания). Выделение диапазона — мышью (зажать и протянуть),
 * Shift+клик или Shift+стрелки, Delete очищает выделенные ячейки. Объединение
 * и разделение ячеек работают как в Google Таблицах, данные копируются и
 * вставляются через буфер обмена в формате TSV (как у Excel и Google Таблиц).
 */
export default function TableEditor({ content, onChange, noteOffset = 0, onActivate }) {
  const [data, setData] = useState(() => normalizeTableData(content.data, LIMITS));
  const [selection, setSelection] = useState(() => ({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } }));
  const [editing, setEditing] = useState(null);
  const [pendingMerge, setPendingMerge] = useState(null);
  const [notice, setNotice] = useState('');
  const gridRef = useRef(null);
  const dragRef = useRef(null);
  const noticeTimer = useRef(null);
  const { tip, openTip, closeTip } = useNoteTip();

  const rect = selectionRect(selection.anchor, selection.focus);
  const mergeAvailable = canMerge(data, rect);
  const splitAvailable = canUnmerge(data, rect);

  // Номера примечаний сквозные: считаем примечания предыдущих ячеек построчно
  const cellOffsets = useMemo(() => {
    const offsets = new Map();
    let running = Math.max(0, Number(noteOffset) || 0);

    data.cells.forEach((row, rowIndex) => {
      row.forEach((doc, columnIndex) => {
        if (isCovered(data.merges, rowIndex, columnIndex)) return;
        offsets.set(`${rowIndex}-${columnIndex}`, running);
        running += collectNotes(doc).length;
      });
    });

    return offsets;
  }, [data.cells, data.merges, noteOffset]);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const update = (next) => {
    setData(next);
    onChange(next);
  };

  const showNotice = (text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), NOTICE_TIMEOUT);
  };

  /** Соседняя ячейка при Tab / Shift+Tab: редактор переезжает вместе с курсором. */
  const moveEditing = (from, delta) => {
    const target = nextInOrder(data, from, delta);
    setSelection({ anchor: target, focus: target });
    setEditing(target);
  };

  /** Изменить размеры таблицы: объединения обрезаются, выделение — по границам. */
  const applyResize = (rows, columns) => {
    const next = resizeTable(data, rows, columns);
    update(next);

    const clamp = (cell) => ({
      row: Math.min(cell.row, next.rows - 1),
      col: Math.min(cell.col, next.columns - 1),
    });

    setSelection((current) => ({ anchor: clamp(current.anchor), focus: clamp(current.focus) }));
    setEditing((current) => (current ? clamp(current) : null));
  };

  const addRow = () => {
    if (data.rows < LIMITS.rows) applyResize(data.rows + 1, data.columns);
  };

  const removeRow = () => {
    if (data.rows > 1) applyResize(data.rows - 1, data.columns);
  };

  const addColumn = () => {
    if (data.columns < LIMITS.columns) applyResize(data.rows, data.columns + 1);
  };

  const removeColumn = () => {
    if (data.columns > 1) applyResize(data.rows, data.columns - 1);
  };

  /* ------------------------------------------------ выделение мышью */

  const handleCellMouseDown = (event, row, column) => {
    if (event.button !== 0) return;
    // Клик по открытой ячейке — работа с текстом, выделение не начинаем
    if (editing && sameCell(editing, { row, col: column })) return;

    event.preventDefault();
    const anchor = anchorOf(data.merges, row, column);

    if (event.shiftKey) {
      // Shift+клик — выделение от прежнего якоря до этой ячейки
      setSelection((current) => ({ anchor: current.anchor, focus: anchor }));
      dragRef.current = null;
    } else {
      setSelection({ anchor, focus: anchor });
      dragRef.current = { start: anchor, moved: false };
    }

    gridRef.current?.focus({ preventScroll: true });
  };

  const handleCellMouseEnter = (row, column) => {
    const drag = dragRef.current;
    if (!drag) return;

    const anchor = anchorOf(data.merges, row, column);
    if (sameCell(anchor, drag.start)) return;

    drag.moved = true;
    setSelection({ anchor: drag.start, focus: anchor });
  };

  const handleGridMouseUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    // Протянули — остаёмся в режиме выделения; одиночный клик открывает ввод
    if (drag && !drag.moved) setEditing(drag.start);
  };

  /* ------------------------------------------------ клавиши на сетке */

  const moveSelection = (event, next, extend) => {
    event.preventDefault();
    setEditing(null);
    setSelection(extend ? (current) => ({ anchor: current.anchor, focus: next }) : { anchor: next, focus: next });
  };

  const handleGridKeyDown = (event) => {
    // Внутри редактора ячейки клавиши обрабатывает Tiptap (см. CellEditor)
    if (event.target !== gridRef.current) return;

    const current = selection.focus;
    const extend = event.shiftKey;
    const key = event.key;

    if (key === 'ArrowUp') return moveSelection(event, nextAnchor(data, current, 'up'), extend);
    if (key === 'ArrowDown') return moveSelection(event, nextAnchor(data, current, 'down'), extend);
    if (key === 'ArrowLeft') return moveSelection(event, nextAnchor(data, current, 'left'), extend);
    if (key === 'ArrowRight') return moveSelection(event, nextAnchor(data, current, 'right'), extend);

    if (key === 'Tab') return moveSelection(event, nextInOrder(data, current, extend ? -1 : 1), false);

    if (key === 'Enter' || key === 'F2') {
      event.preventDefault();
      return setEditing(current);
    }

    if (key === 'Escape') return setEditing(null);

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
      event.preventDefault();
      return setSelection({
        anchor: { row: 0, col: 0 },
        focus: { row: data.rows - 1, col: data.columns - 1 },
      });
    }

    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      return update(clearRect(data, rect));
    }
  };

  /** Tab и Esc внутри редактора ячейки: перейти к соседней ячейке / выйти. */
  const handleCellKeyDown = (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      moveEditing(editing, event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(null);
      gridRef.current?.focus({ preventScroll: true });
    }
  };

  /* ------------------------------------------------ объединение ячеек */

  const applyMerge = (target) => {
    update(mergeRectCells(data, target));
    setEditing(null);
    setSelection({ anchor: { row: target.top, col: target.left }, focus: { row: target.top, col: target.left } });
  };

  const mergeSelection = () => {
    if (!mergeAvailable) return;

    // Данные останутся только в верхней левой ячейке — предупреждаем,
    // как Google Таблицы, и ждём подтверждения
    if (hasTextOutsideAnchor(data, rect)) {
      setPendingMerge(rect);
      return;
    }

    applyMerge(rect);
  };

  const splitSelection = () => {
    if (splitAvailable) update(unmergeRectCells(data, rect));
    setEditing(null);
  };

  /* ------------------------------------------------ буфер обмена (TSV) */

  const pasteText = (text, start) => {
    const value = String(text ?? '');
    if (!value.trim()) {
      showNotice('Буфер обмена пуст');
      return;
    }

    const { rows: matrix } = parseCsv(value, { delimiter: '\t' });
    const multi = matrix.length > 1 || (matrix[0]?.length ?? 0) > 1;
    const source = multi ? matrix : [[value]];
    const result = pasteMatrix(data, start, source, LIMITS);
    const wanted = {
      rows: source.length,
      columns: Math.max(...source.map((line) => line.length)),
    };
    const clipped = start.row + wanted.rows > LIMITS.rows || start.col + wanted.columns > LIMITS.columns;

    update(result.data);
    setEditing(null);
    setSelection({ anchor: start, focus: start });
    showNotice(
      `Вставлено ${result.rows}×${result.columns}${
        clipped ? ` — остальное не влезло, лимит таблицы ${LIMITS.rows}×${LIMITS.columns}` : ''
      }`,
    );
  };

  const copyTable = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard');
      await navigator.clipboard.writeText(tableToTsv(data));
      showNotice('Таблица скопирована — вставляйте в Excel или Google Таблицы');
    } catch {
      showNotice('Браузер не дал доступ к буферу обмена — выделите ячейку и нажмите Ctrl+C');
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (typeof text !== 'string') throw new Error('clipboard');
      pasteText(text, editing ?? selection.anchor);
    } catch {
      showNotice('Нет доступа к буферу обмена — выделите ячейку и нажмите Ctrl+V');
    }
  };

  /** Ctrl+V: несколько ячеек раскладываем по сетке, обычный текст оставляем Tiptap. */
  const handlePasteCapture = (event) => {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;

    const { rows: matrix } = parseCsv(text, { delimiter: '\t' });
    const multi = matrix.length > 1 || (matrix[0]?.length ?? 0) > 1;
    if (!multi && editing) return;

    event.preventDefault();
    event.stopPropagation();
    pasteText(text, editing ?? selection.anchor);
  };

  /** Ctrl+C при выделенной сетке копирует всю таблицу (внутри ячейки — обычное копирование). */
  const handleCopy = (event) => {
    if (event.target !== gridRef.current) return;
    event.preventDefault();
    copyTable();
  };

  return (
    <div className="content-editor-form">
      <EditorActions>
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRow} disabled={data.rows >= LIMITS.rows}>
          <Icon name="plus" size={14} /> Строка
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={removeRow} disabled={data.rows <= 1}>
          <Icon name="minus" size={14} /> Строка
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={addColumn} disabled={data.columns >= LIMITS.columns}>
          <Icon name="plus" size={14} /> Колонка
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={removeColumn} disabled={data.columns <= 1}>
          <Icon name="minus" size={14} /> Колонка
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={mergeSelection}
          disabled={!mergeAvailable}
          title="Объединить выделенные ячейки"
        >
          <Icon name="merge" size={14} /> Объединить
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={splitSelection}
          disabled={!splitAvailable}
          title="Разделить объединённые ячейки"
        >
          <Icon name="unmerge" size={14} /> Разделить
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={copyTable}
          title="Скопировать таблицу — вставить можно в Excel или Google Таблицы"
        >
          <Icon name="copy" size={14} /> Скопировать
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={pasteFromClipboard}
          title="Вставить данные из Excel или Google Таблиц"
        >
          <Icon name="paste" size={14} /> Вставить из буфера
        </button>
      </EditorActions>

      <div
        className="table-editor"
        ref={gridRef}
        tabIndex={0}
        role="group"
        aria-label={`Таблица ${data.rows}×${data.columns}`}
        onKeyDown={handleGridKeyDown}
        onPasteCapture={handlePasteCapture}
        onCopy={handleCopy}
        onMouseUp={handleGridMouseUp}
      >
        <table className="table-editor__table">
          <tbody>
            {data.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((doc, columnIndex) => {
                  if (isCovered(data.merges, rowIndex, columnIndex)) return null;

                  const merge = mergeAt(data.merges, rowIndex, columnIndex);
                  const anchor = { row: rowIndex, col: columnIndex };
                  const inEdit = sameCell(editing, anchor);
                  const offset = cellOffsets.get(`${rowIndex}-${columnIndex}`) ?? noteOffset;

                  return (
                    <td
                      key={columnIndex}
                      rowSpan={merge && merge.rowSpan > 1 ? merge.rowSpan : undefined}
                      colSpan={merge && merge.colSpan > 1 ? merge.colSpan : undefined}
                      className={[
                        'table-editor__cell',
                        rowIndex === 0 && data.headerRow ? 'is-header' : '',
                        isInRect(rect, rowIndex, columnIndex) ? 'is-selected' : '',
                        inEdit ? 'is-editing' : '',
                        merge ? 'is-merged' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={`Ячейка ${rowIndex + 1}×${columnIndex + 1}`}
                      onMouseDown={(event) => handleCellMouseDown(event, rowIndex, columnIndex)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, columnIndex)}
                    >
                      {inEdit ? (
                        <CellEditor
                          key={`${rowIndex}-${columnIndex}`}
                          value={doc}
                          noteOffset={offset}
                          label={`Ячейка ${rowIndex + 1}×${columnIndex + 1}`}
                          onChange={(next) => update(setCellDoc(data, rowIndex, columnIndex, next))}
                          onActivate={onActivate}
                          onKeyDown={handleCellKeyDown}
                        />
                      ) : (
                        <div
                          className="table-editor__cell-view"
                          onMouseOver={openTip}
                          onFocus={openTip}
                          onClick={openTip}
                        >
                          <DocContent doc={doc} noteOffset={offset} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditorField hint="Выделите ячейки мышью или Shift+стрелками, затем объедините. Форматирование текста — на панели инструментов блока.">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={data.headerRow}
            onChange={(event) => update({ ...data, headerRow: event.target.checked })}
          />
          <span>Первая строка — заголовок</span>
        </label>
      </EditorField>

      {notice && (
        <p className="table-editor__notice" role="status">
          {notice}
        </p>
      )}

      <p className="content-field__hint">
        {data.rows} × {data.columns} · не больше {LIMITS.rows} строк и {LIMITS.columns} колонок
      </p>

      {tip && <NoteTip tip={tip} onClose={closeTip} />}

      {pendingMerge && (
        <ConfirmModal
          title="Объединить ячейки?"
          message="В выбранных ячейках есть текст. Он будет удалён при объединении. Продолжить?"
          confirmLabel="Объединить"
          cancelLabel="Отмена"
          variant="primary"
          onConfirm={() => {
            const target = pendingMerge;
            setPendingMerge(null);
            applyMerge(target);
          }}
          onCancel={() => setPendingMerge(null)}
        />
      )}
    </div>
  );
}
