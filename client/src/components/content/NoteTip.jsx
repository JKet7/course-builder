import { useEffect, useState } from 'react';

/** Ширина подсказки: совпадает с .note-tip и расчетом позиции. */
const TIP_WIDTH = 280;

/**
 * Подсказка примечания (Правка 5) в режиме читателя.
 *
 * В окне только текст примечания и кнопка закрытия: плашка «Примечание N»
 * убрана, чтобы плашка не перекрывала само пояснение.
 */
export default function NoteTip({ tip, onClose }) {
  return (
    <div
      className="note-tip"
      role="tooltip"
      style={{ top: `${tip.top}px`, left: `${tip.left}px`, width: `${tip.width}px` }}
    >
      <button type="button" className="note-tip__close" aria-label="Закрыть примечание" onClick={onClose}>
        ×
      </button>
      <p className="note-tip__text">{tip.text || 'Текст примечания не заполнен'}</p>
    </div>
  );
}

/**
 * Состояние подсказки: показывается по наведению, тапу или фокусу на слове
 * с примечанием и на его номере. Общий хук для Tiptap-документов и обычного
 * текста (таблица, чек-лист, подписи).
 */
export function useNoteTip() {
  const [tip, setTip] = useState(null);

  useEffect(() => {
    if (!tip) return undefined;

    const handlePointer = (event) => {
      if (event.target?.closest?.('.note-tip')) return;
      setTip(null);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setTip(null);
    };
    const handleScroll = () => setTip(null);

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [tip]);

  const openTip = (event) => {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;

    const element = target.closest('[data-note-id]');
    if (!element) return;

    const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
    const viewport = typeof window !== 'undefined' ? window.innerWidth || TIP_WIDTH + 16 : TIP_WIDTH + 16;
    const centered = rect ? rect.left + rect.width / 2 - TIP_WIDTH / 2 : 8;

    setTip({
      text: element.getAttribute('data-note-text') ?? '',
      top: rect ? Math.max(rect.top - 8, 8) : 8,
      left: Math.max(8, Math.min(centered, Math.max(8, viewport - TIP_WIDTH - 8))),
      width: TIP_WIDTH,
    });
  };

  const closeTip = () => setTip(null);

  return { tip, openTip, closeTip };
}
