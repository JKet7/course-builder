import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

// SSR (render-check) рендерит в строку без DOM — тогда портал недоступен.
const canUseDom = typeof document !== 'undefined' && Boolean(document.body);

/**
 * Базовое модальное окно: затемнение, закрытие по Esc и клику по фону,
 * блокировка прокрутки страницы, фокус внутри диалога.
 *
 * <Modal title="..." onClose={close} footer={<Button/>}>...</Modal>
 */
export default function Modal({
  title,
  subtitle,
  size = 'md',
  onClose,
  children,
  footer,
  closeOnBackdrop = true,
  className = '',
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  // Фокус в диалог и возврат прокрутки/фокуса при закрытии
  useEffect(() => {
    if (!canUseDom) return undefined;

    const previousActive = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Фокус в первое поле формы, иначе — в сам диалог
    const initialTarget = dialogRef.current?.querySelector('input, textarea, select') ?? dialogRef.current;
    initialTarget?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousActive instanceof HTMLElement) previousActive.focus();
    };
  }, []);

  // Esc закрывает модалку
  useEffect(() => {
    if (!canUseDom) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropMouseDown = (event) => {
    if (!closeOnBackdrop) return;
    // Закрываем только по клику именно на фон, не по перетаскиванию изнутри
    if (event.target === event.currentTarget) onClose?.();
  };

  const content = (
    <div className="modal-overlay" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className={['modal', `modal--${size}`, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title" id={title ? titleId : undefined}>
              {title}
            </h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>

          <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="modal__body">{children}</div>

        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );

  return canUseDom ? createPortal(content, document.body) : content;
}
