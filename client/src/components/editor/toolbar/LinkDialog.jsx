import { useMemo, useState } from 'react';
import Button from '../../ui/Button.jsx';
import Icon from '../../ui/Icon.jsx';
import Modal from '../../ui/Modal.jsx';
import { useLinkStore } from '../../../store/linkStore.js';
import {
  buildTargetBadge,
  buildTargetLabel,
  internalHref,
  normalizeExternalHref,
} from '../../../utils/links.js';
import { getBlockIcon, getBlockTypeLabel } from '../../../utils/helpers.js';

/** Подпись элемента в дереве: «Слайд 3: Введение». */
function itemLabel(block, item) {
  const number = Number(item.index) + 1;

  if (block.type === 'theory') return item.title ? `Слайд ${number}: ${item.title}` : `Слайд ${number}`;
  if (block.type === 'test') return item.title ? `Вопрос ${number}: ${item.title}` : `Вопрос ${number}`;
  if (block.type === 'memo') return item.title ? `Ячейка ${number}: ${item.title}` : `Ячейка ${number}`;
  return item.title || 'Термин';
}

/** Какой тип цели у элемента блока. */
const ITEM_TARGET_TYPE = { theory: 'slide', test: 'question', memo: 'memo', glossary: 'term' };

/** Дерево курса с фильтром: блоки и их элементы. */
function LinkTree({ map, mapLoading, mapError, onReload, target, onPick }) {
  const [query, setQuery] = useState('');

  const blocks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = map?.blocks ?? [];

    if (!needle) return list;

    return list
      .map((block) => {
        const typeLabel = getBlockTypeLabel(block.type).toLowerCase();
        const blockHit = block.title.toLowerCase().includes(needle) || typeLabel.includes(needle);
        const items = block.items.filter((item) => itemLabel(block, item).toLowerCase().includes(needle));
        return items.length > 0 || blockHit ? { ...block, items } : null;
      })
      .filter(Boolean);
  }, [map, query]);

  if (mapLoading && !map) {
    return (
      <div className="link-tree link-tree--status" role="status">
        <Icon name="loader" size={18} className="icon--spin" />
        Загружаем элементы курса…
      </div>
    );
  }

  if (mapError) {
    return (
      <div className="link-tree link-tree--status">
        <p className="content-field__error">{mapError}</p>
        <Button size="sm" variant="secondary" onClick={onReload}>
          Повторить
        </Button>
      </div>
    );
  }

  if (!map) {
    return (
      <div className="link-tree link-tree--status">
        Внутренние ссылки доступны внутри курса: откройте блок из курса.
      </div>
    );
  }

  return (
    <div className="link-tree-wrap">
      <div className="link-tree__search">
        <Icon name="search" size={14} />
        <input
          className="input input--sm"
          value={query}
          placeholder="Найти блок, слайд, вопрос, термин…"
          aria-label="Поиск элемента курса"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="link-tree" role="tree" aria-label="Элементы курса">
        <p className="link-tree__course">{map.title}</p>

        {blocks.length === 0 && <p className="link-tree__empty">Ничего не найдено</p>}

        {blocks.map((block) => {
          const blockActive = target?.targetType === 'block' && target?.targetBlockId === block.id;

          return (
            <div className="link-tree__block" key={block.id} role="group">
              <button
                type="button"
                className={`link-tree__block-btn${blockActive ? ' is-active' : ''}`}
                onClick={() =>
                  onPick({
                    targetType: 'block',
                    targetId: block.id,
                    targetBlockId: block.id,
                    targetLabel: buildTargetLabel(block, null, 'block'),
                    targetBadge: buildTargetBadge(block, 'block'),
                  })
                }
              >
                <Icon name={getBlockIcon(block.type)} size={14} />
                <span className="link-tree__block-title">{block.title}</span>
                <span className="link-tree__badge">{getBlockTypeLabel(block.type)}</span>
              </button>

              {block.items.length > 0 && (
                <ul className="link-tree__items">
                  {block.items.map((item) => {
                    const targetType = ITEM_TARGET_TYPE[block.type];
                    const active = target?.targetType === targetType && target?.targetId === item.id;

                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`link-tree__item${active ? ' is-active' : ''}`}
                          onClick={() =>
                            onPick({
                              targetType,
                              targetId: item.id,
                              targetBlockId: block.id,
                              targetLabel: buildTargetLabel(block, item, targetType),
                              targetBadge: buildTargetBadge(block, targetType),
                            })
                          }
                        >
                          {itemLabel(block, item)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Диалог ссылки (Правка 6): внешняя или внутренняя и текст ссылки.
 * Открывается из панели инструментов, по Ctrl+K, из контекстного меню
 * и с иконки у поля обычного текста.
 */
export default function LinkDialog() {
  const dialog = useLinkStore((state) => state.dialog);
  const map = useLinkStore((state) => state.map);
  const mapLoading = useLinkStore((state) => state.mapLoading);
  const mapError = useLinkStore((state) => state.mapError);
  const reloadMap = useLinkStore((state) => state.reloadMap);
  const closeDialog = useLinkStore((state) => state.closeDialog);

  if (!dialog) return null;

  return (
    <LinkDialogBody
      dialog={dialog}
      map={map}
      mapLoading={mapLoading}
      mapError={mapError}
      onReload={reloadMap}
      onClose={closeDialog}
    />
  );
}

function LinkDialogBody({ dialog, map, mapLoading, mapError, onReload, onClose }) {
  const initial = dialog.initial ?? {};

  const [kind, setKind] = useState(initial.kind === 'internal' ? 'internal' : 'external');
  const [text, setText] = useState(initial.text ?? '');
  const [href, setHref] = useState(initial.kind === 'internal' ? '' : initial.href ?? '');
  const [newTab, setNewTab] = useState(initial.newTab ?? true);
  const [target, setTarget] = useState(initial.target ?? null);
  const [error, setError] = useState(null);

  const editing = Boolean(initial.hasLink);

  const submit = () => {
    setError(null);

    if (kind === 'internal') {
      if (!target) {
        setError('Выберите блок, слайд, вопрос, ячейку или термин');
        return;
      }

      const link = {
        kind: 'internal',
        href: internalHref(target),
        text: text.trim(),
        ...target,
        newTab: false,
      };

      if (dialog.apply?.(link) === false) setError('Не удалось поставить ссылку — выделите слово в тексте');
      else onClose();
      return;
    }

    const url = normalizeExternalHref(href);
    if (!url) {
      setError('Укажите адрес ссылки');
      return;
    }

    const link = { kind: 'external', href: url, text: text.trim(), newTab };

    if (dialog.apply?.(link) === false) setError('Не удалось поставить ссылку — выделите слово в тексте');
    else onClose();
  };

  const remove = () => {
    if (dialog.remove?.()) onClose();
    else setError('Ссылка не найдена');
  };

  const footer = (
    <div className="link-dialog__footer">
      {editing && (
        <Button variant="ghost" size="sm" onClick={remove} className="link-dialog__delete">
          <Icon name="trash" size={14} />
          Удалить ссылку
        </Button>
      )}

      <span className="link-dialog__spacer" />

      <Button variant="ghost" size="sm" onClick={onClose}>
        Отмена
      </Button>
      <Button size="sm" onClick={submit}>
        Сохранить
      </Button>
    </div>
  );

  return (
    <Modal
      title={editing ? 'Изменить ссылку' : 'Добавить ссылку'}
      subtitle="Ссылка на внешний ресурс или на элемент этого курса"
      size="md"
      onClose={onClose}
      footer={footer}
    >
      <form
        className="link-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="link-dialog__tabs" role="tablist" aria-label="Тип ссылки">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'external'}
            className={`link-dialog__tab${kind === 'external' ? ' is-active' : ''}`}
            onClick={() => setKind('external')}
          >
            <Icon name="external" size={14} />
            Внешняя ссылка
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'internal'}
            className={`link-dialog__tab${kind === 'internal' ? ' is-active' : ''}`}
            onClick={() => setKind('internal')}
          >
            <Icon name="link" size={14} />
            Внутренняя ссылка
          </button>
        </div>

        {kind === 'external' ? (
          <>
            <label className="content-field" htmlFor="link-dialog-href">
              <span className="content-field__label">Адрес</span>
              <input
                id="link-dialog-href"
                className="input input--sm"
                value={href}
                placeholder="https://example.com"
                autoComplete="off"
                onChange={(event) => setHref(event.target.value)}
              />
              <span className="content-field__hint">Можно вставить адрес без https:// — он добавится сам.</span>
            </label>

            <label className="checkbox">
              <input type="checkbox" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} />
              <span>Открыть в новой вкладке</span>
            </label>
          </>
        ) : (
          <>
            <LinkTree
              map={map}
              mapLoading={mapLoading}
              mapError={mapError}
              onReload={onReload}
              target={target}
              onPick={setTarget}
            />

            {target && (
              <p className="link-dialog__target">
                <Icon name="link" size={14} />
                <span>{target.targetLabel}</span>
                <span className="link-tree__badge">{target.targetBadge}</span>
              </p>
            )}
          </>
        )}

        <label className="content-field" htmlFor="link-dialog-text">
          <span className="content-field__label">Текст ссылки</span>
          <input
            id="link-dialog-text"
            className="input input--sm"
            value={text}
            placeholder={initial.text ? '' : 'Выделенное слово'}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="content-field__hint">Если оставить пустым — останется выделенный текст.</span>
        </label>

        {error && (
          <p className="content-field__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
