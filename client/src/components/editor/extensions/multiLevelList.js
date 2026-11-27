import { Extension } from '@tiptap/core';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  collectListNumbering,
  createListId,
  listLevelsFromNode,
  normalizeListLevels,
} from '../../../utils/listNumbering.js';

/**
 * Многоуровневые списки в редакторе (Правка 4).
 *
 * Стандартные bulletList/orderedList из StarterKit получают атрибуты:
 * - listId — идентификатор списка (списки нумеруются независимо);
 * - levels — конфигурация 9 уровней (тип, формат, шаблон, отступ, старт).
 *
 * Номера не хранятся в документе: плагин ListNumbering считает их на лету
 * и проставляет в DOM атрибуты data-list-label (маркер) и отступы.
 */

const LIST_TYPES = ['orderedList', 'bulletList'];

/** Атрибуты списка с настройками уровней. */
function listSettingsAttributes() {
  return {
    listId: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-list-id'),
      renderHTML: (attributes) => (attributes.listId ? { 'data-list-id': attributes.listId } : {}),
    },
    levels: {
      default: null,
      parseHTML: (element) => {
        const raw = element.getAttribute('data-levels');
        if (!raw) return null;

        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      },
      renderHTML: (attributes) =>
        Array.isArray(attributes.levels) ? { 'data-levels': JSON.stringify(attributes.levels) } : {},
    },
  };
}

/** Нумерованный список с настройками многоуровневого списка. */
export const MultiLevelOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listSettingsAttributes() };
  },
});

/** Маркированный список с настройками многоуровневого списка. */
export const MultiLevelBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listSettingsAttributes() };
  },
});

const pathKey = (path) => path.join('.');

/**
 * Декорации списков: подпись пункта и отступы.
 * Опираются на те же вычисления, что просмотр и печать (utils/listNumbering.js).
 */
function buildListDecorations(doc) {
  const { items, lists } = collectListNumbering(doc.toJSON().content);
  if (items.length === 0) return DecorationSet.empty;

  const itemByPath = new Map(items.map((item) => [pathKey(item.path), item]));
  const listByPath = new Map(lists.map((list) => [pathKey(list.path), list]));
  const decorations = [];

  const walk = (node, path, position) => {
    const contentStart = position + 1;
    let index = 0;

    node.forEach((child, offset) => {
      const childPath = [...path, index];
      const childPosition = contentStart + offset;
      const key = pathKey(childPath);

      const item = itemByPath.get(key);
      if (item) {
        decorations.push(
          Decoration.node(childPosition, childPosition + child.nodeSize, {
            'data-list-label': item.label,
            'data-list-level': String(item.level),
            style: `--list-indent: ${item.indent}em`,
          }),
        );
      }

      const list = listByPath.get(key);
      if (list) {
        decorations.push(
          Decoration.node(childPosition, childPosition + child.nodeSize, {
            'data-list-level': String(list.level),
            style: `--list-indent: ${list.indent}em; padding-left: ${list.indent}em`,
          }),
        );
      }

      if (child.isBlock) walk(child, childPath, childPosition);
      index += 1;
    });
  };

  walk(doc, [], -1);
  return DecorationSet.create(doc, decorations);
}

/** Плагин, который держит номера списков в актуальном состоянии. */
export const ListNumbering = Extension.create({
  name: 'listNumbering',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listNumbering'),
        props: {
          decorations: (state) => buildListDecorations(state.doc),
        },
      }),
    ];
  },
});

/** Верхний (внешний) список вокруг курсора: { node, pos, name } или null. */
export function getRootListAtSelection(editor) {
  if (!editor || editor.isDestroyed) return null;

  const { $from } = editor.state.selection;
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    const node = $from.node(depth);
    if (LIST_TYPES.includes(node.type.name)) return { node, pos: $from.before(depth), name: node.type.name };
  }

  return null;
}

/** Конфигурация уровней списка под курсором (по умолчанию — 9 стандартных). */
export function getCurrentListLevels(editor) {
  return listLevelsFromNode(getRootListAtSelection(editor)?.node);
}

/**
 * Применить настройки уровней к списку под курсором.
 * Возвращает false, если курсор не внутри списка.
 */
export function applyListLevels(editor, levels) {
  const list = getRootListAtSelection(editor);
  if (!list) return false;

  const attrs = {
    ...list.node.attrs,
    listId: list.node.attrs.listId ?? createListId(),
    levels: normalizeListLevels(levels),
  };

  editor.view.dispatch(editor.state.tr.setNodeMarkup(list.pos, undefined, attrs));
  return true;
}

/** Выдать списку под курсором listId, если его ещё нет. Возвращает id или null. */
export function ensureRootListId(editor) {
  const list = getRootListAtSelection(editor);
  if (!list) return null;
  if (list.node.attrs.listId) return list.node.attrs.listId;

  const listId = createListId();
  editor.view.dispatch(editor.state.tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, listId }));
  return listId;
}
