import { useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import Modal from '../ui/Modal.jsx';
import { decodeCsvBytes } from '../../utils/csv.js';

/** data-ссылка для скачивания шаблона (BOM — чтобы Excel понял UTF-8). */
const templateHref = (content) => `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${content}`)}`;

/**
 * Общая модалка импорта CSV (тест и глоссарий, Шаг 11).
 * parse(text) → { items, errors }, onImport(items) → { ok, created?, message? }.
 * preview(items) → строки предпросмотра (первые пять показываются списком).
 * templates — шаблоны для скачивания: [{ id, name, fileName, content, columns }].
 */
export default function CsvImportModal({
  title = 'Импорт CSV',
  hint,
  columns,
  templates = [],
  parse,
  preview,
  onImport,
  onClose,
  limit = 100,
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const { items, errors } = parse(text);
  const overLimit = items.length > limit;
  const canImport = items.length > 0 && !overLimit && !importing;

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResult(null);
    setText(decodeCsvBytes(await file.arrayBuffer()));
    event.target.value = '';
  };

  const handleImport = async () => {
    setImporting(true);
    const response = await onImport(items);
    setImporting(false);
    setResult(response ?? { ok: true });
  };

  return (
    <Modal
      title={title}
      subtitle={hint}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {result?.ok ? 'Готово' : 'Отмена'}
          </Button>
          <Button onClick={handleImport} disabled={!canImport}>
            {importing ? (
              <>
                <Icon name="loader" size={16} className="icon--spin" />
                Импортируем…
              </>
            ) : (
              `Импортировать${items.length ? ` (${items.length})` : ''}`
            )}
          </Button>
        </>
      }
    >
      <div className="csv-import">
        {columns && (
          <p className="csv-import__hint">
            <code>{columns}</code>
          </p>
        )}

        {templates.length > 0 && (
          <div className="csv-import__templates">
            <span className="csv-import__templates-label">Шаблоны для заполнения:</span>
            {templates.map((template) => (
              <a
                key={template.id ?? template.fileName}
                className="csv-import__template"
                href={templateHref(template.content)}
                download={template.fileName}
                title={template.columns}
              >
                <Icon name="download" size={14} />
                {template.name}
              </a>
            ))}
          </div>
        )}

        <textarea
          className="input csv-import__area"
          rows={8}
          value={text}
          placeholder="Вставьте строки CSV или выберите файл"
          aria-label="Содержимое CSV"
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
          }}
        />

        <div className="csv-import__file">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="visually-hidden"
            onChange={handleFile}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} />
            Выбрать файл
          </Button>
          {fileName && <span className="csv-import__file-name">{fileName}</span>}
        </div>

        <div className="csv-import__summary" role="status">
          <span className="badge badge--gray">
            <Icon name="table" size={14} />
            Готово к импорту: {items.length}
          </span>
          {overLimit && <span className="content-field__error">За один раз — не больше {limit} строк</span>}
        </div>

        {preview && items.length > 0 && (
          <ul className="csv-import__preview" aria-label="Предпросмотр импорта">
            {preview(items)
              .slice(0, 5)
              .map((line, index) => (
                <li className="csv-import__preview-row" key={index}>
                  {line}
                </li>
              ))}

            {items.length > 5 && (
              <li className="csv-import__preview-row csv-import__preview-row--more">
                …и ещё {items.length - 5}
              </li>
            )}
          </ul>
        )}

        {errors.length > 0 && (
          <ul className="csv-import__errors">
            {errors.slice(0, 5).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {errors.length > 5 && <li>…и ещё {errors.length - 5}</li>}
          </ul>
        )}

        {result && (
          <div className={result.ok ? 'alert alert--success' : 'alert alert--error'} role="status">
            <Icon name={result.ok ? 'check' : 'alert'} size={18} />
            <span className="alert__text">
              {result.ok
                ? result.message ?? `Импортировано: ${result.created ?? items.length}`
                : result.message ?? 'Не удалось выполнить импорт'}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
