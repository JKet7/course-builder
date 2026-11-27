import { mergeAttributes } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import { linkTooltip } from '../../../utils/links.js';

/**
 * Ссылка в тексте (Правка 6).
 *
 * Расширяет метку link из @tiptap/extension-link: кроме href хранит вид ссылки
 * и описание цели, чтобы редактор и просмотр показывали «Ведёт на: …» без
 * обращения к серверу. Внешняя ссылка по умолчанию открывается в новой
 * вкладке (если автор не снял галочку), внутренняя — через роутер.
 *
 * В HTML атрибуты попадают как data-*: по ним просмотр отличает внутреннюю
 * ссылку от внешней и рисует переход, а не обычный <a>.
 */
export const CourseLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),

      /** 'external' | 'internal' */
      linkKind: {
        default: 'external',
        parseHTML: (element) => (element.getAttribute('data-link-kind') === 'internal' ? 'internal' : 'external'),
      },

      /** 'block' | 'slide' | 'question' | 'memo' | 'term' */
      targetType: { default: '', parseHTML: (element) => element.getAttribute('data-target-type') ?? '' },
      targetId: { default: '', parseHTML: (element) => element.getAttribute('data-target-id') ?? '' },
      targetBlockId: { default: '', parseHTML: (element) => element.getAttribute('data-target-block') ?? '' },
      targetLabel: { default: '', parseHTML: (element) => element.getAttribute('data-target-label') ?? '' },
      targetBadge: { default: '', parseHTML: (element) => element.getAttribute('data-target-badge') ?? '' },

      /** Внешняя ссылка: открыть в новой вкладке (null — старая ссылка: смотрим target). */
      newTab: {
        default: null,
        parseHTML: (element) => (element.getAttribute('target') === '_blank' ? true : null),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const {
      linkKind = 'external',
      targetType,
      targetId,
      targetBlockId,
      targetLabel,
      targetBadge,
      newTab,
      href,
      // target/rel вычисляем сами: у внутренних ссылок их быть не должно
      target: legacyTarget,
      rel: _rel,
      // eslint-disable-next-line no-unused-vars
      ...rest
    } = HTMLAttributes;

    const internal = linkKind === 'internal';
    const link = { kind: linkKind, targetType, targetId, targetBlockId, targetLabel, targetBadge, newTab };
    const allowed = this.options.isAllowedUri(href, {
      defaultValidate: (url) => Boolean(url),
      protocols: this.options.protocols,
      defaultProtocol: this.options.defaultProtocol,
    });

    // У старых ссылок атрибута newTab нет — они открывались в новой вкладке
    const openInNewTab = !internal && (newTab ?? legacyTarget === '_blank');

    return [
      'a',
      mergeAttributes(rest, {
        href: allowed ? href : '',
        title: linkTooltip(link) || null,
        target: openInNewTab ? '_blank' : null,
        rel: openInNewTab ? 'noopener noreferrer' : null,
        'data-link-kind': internal ? 'internal' : 'external',
        'data-target-type': internal ? targetType : null,
        'data-target-id': internal ? targetId : null,
        'data-target-block': internal ? targetBlockId : null,
        'data-target-label': internal ? targetLabel : null,
        'data-target-badge': internal ? targetBadge : null,
      }),
      0,
    ];
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: {},
});
