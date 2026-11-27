import { codeGutter, safeCodeText } from '../../utils/code.js';

/**
 * Тёмное полотно кода в духе VS Code (Правка 8): слева жёлоб с номерами
 * строк, справа сам код. Используется и в просмотре, и в редакторе, поэтому
 * фон и нумерация у них одинаковые.
 *
 * Код выводится только текстовыми узлами (children), без HTML-вставок,
 * поэтому его содержимое не может повлиять на страницу.
 */
export default function CodeSurface({ code = '', className = '', gutterRef, children }) {
  return (
    <div className={['code-surface', className].filter(Boolean).join(' ')}>
      <pre className="code-surface__gutter" ref={gutterRef} aria-hidden="true">{codeGutter(safeCodeText(code))}</pre>
      <div className="code-surface__body">{children}</div>
    </div>
  );
}
