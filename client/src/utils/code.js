/**
 * Помощники фрагмента «Код» (Правка 8).
 *
 * Безопасность: код — это только текст. Он никогда не вставляется как HTML
 * (dangerouslySetInnerHTML), не исполняется через eval/Function и не влияет
 * на разметку страницы: React экранирует <, >, & и кавычки, поэтому
 * <script>, </code> и подобное остаются видимыми символами.
 */

/** Невидимый NUL ломает DOM и буфер обмена; меняем на пробел той же длины. */
export function safeCodeText(value) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  return text.replace(/\u0000/g, ' ');
}

/** Сколько строк в коде (пустой код — одна строка, как в VS Code). */
export function countCodeLines(value) {
  const text = safeCodeText(value);
  let count = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }

  return count;
}

/**
 * Номера строк для жёлоба: один текстовый узел вместо тысяч <span>.
 * Каждый номер — отдельная строка, поэтому <pre> выравнивает их по высоте
 * строки кода без дополнительной разметки.
 */
export function codeGutter(value) {
  const lines = countCodeLines(value);
  let gutter = '1';

  for (let number = 2; number <= lines; number += 1) {
    gutter += `\n${number}`;
  }

  return gutter;
}
