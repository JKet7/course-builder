import Button from './Button.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

/**
 * Подтверждение действия (удаление курса, блока и т.д.).
 * message — строка или JSX.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Удалить',
  cancelLabel = 'Отмена',
  variant = 'danger',
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={loading ? undefined : onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading && <Icon name="loader" size={16} className="icon--spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof message === 'string' ? <p className="modal__text">{message}</p> : message}

      {error && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{error}</span>
        </div>
      )}
    </Modal>
  );
}
