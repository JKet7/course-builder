import { useEffect } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import Modal from '../ui/Modal.jsx';
import { useInternalLink } from '../content/useInternalLink.js';
import { useAuthStore } from '../../store/authStore.js';
import { useHelpStore } from '../../store/helpStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { formatDate, getBlockIcon } from '../../utils/helpers.js';

/**
 * Как называть блок в разделе «Упоминается в»: у теории и теста в примерах
 * из ТЗ стоит просто «Блок», у памятки и глоссария — свой тип.
 */
const MENTION_PREFIX = {
  theory: 'Блок',
  test: 'Блок',
  memo: 'Памятка',
  glossary: 'Глоссарий',
};

/** Подпись упоминания: «Блок «Настройка системы» (слайд 2)». */
function mentionLabel(mention) {
  const prefix = MENTION_PREFIX[mention.blockType] ?? 'Блок';
  return `${prefix} «${mention.blockTitle}» (${mention.place})`;
}

/**
 * Справка о блоке (Правка 7): дата изменения, сноски и обратные ссылки.
 *
 * В режиме редактора примечание — кнопка: клик ведёт к слайду, вопросу,
 * ячейке или термину, где стоит примечание. В режиме читателя список
 * показывается текстом, а упоминания остаются ссылками на блоки курса.
 */
export default function HelpModal({ block, onClose }) {
  const help = useHelpStore((state) => state.help);
  const loading = useHelpStore((state) => state.loading);
  const error = useHelpStore((state) => state.error);
  const fetchHelp = useHelpStore((state) => state.fetchHelp);
  const reset = useHelpStore((state) => state.reset);

  const uiMode = useUiStore((state) => state.uiMode);
  const isEditor = useAuthStore((state) => state.isEditor);
  const openLink = useInternalLink();

  const blockId = block?.id ?? '';

  // Справка всегда свежая: данные грузим при каждом открытии
  useEffect(() => {
    if (blockId) fetchHelp(blockId);
    return () => reset();
  }, [blockId, fetchHelp, reset]);

  // Ответ от прошлого блока не показываем
  const data = help && help.block?.id === blockId ? help : null;
  const canOpenNote = isEditor && uiMode === 'edit';

  const go = (href) => {
    if (!href) return;
    onClose?.();
    openLink({ href });
  };

  const footer = (
    <Button variant="secondary" onClick={onClose}>
      Закрыть
    </Button>
  );

  return (
    <Modal title={`Справка: ${block?.title ?? 'блок'}`} size="md" onClose={onClose} footer={footer}>
      <div className="help-modal">
        <p className="help-modal__date">
          Дата последнего изменения:
          <span className="help-modal__date-value">{formatDate(data?.updatedAt ?? block?.updatedAt) || '—'}</span>
        </p>

        {loading && !data && (
          <div className="help-status" role="status">
            <Icon name="loader" size={18} className="icon--spin" />
            Загружаем справку…
          </div>
        )}

        {error && (
          <div className="alert alert--error" role="alert">
            <Icon name="alert" size={18} />
            <span className="alert__text">{error}</span>
            <Button variant="ghost" size="sm" onClick={() => fetchHelp(blockId)}>
              Повторить
            </Button>
          </div>
        )}

        {data && (
          <>
            <section className="help-section" aria-labelledby="help-notes-title">
              <h3 className="help-section__title" id="help-notes-title">
                Сноски (примечания)
              </h3>

              {data.notes.length === 0 && <p className="help-section__empty">Примечаний нет</p>}

              {data.notes.length > 0 && (
                <ol className="help-notes">
                  {data.notes.map((note) => (
                    <li key={note.noteId}>
                      {canOpenNote ? (
                        <button
                          type="button"
                          className="help-note help-note--link"
                          title={`Перейти к месту примечания: ${note.place}`}
                          onClick={() => go(note.href)}
                        >
                          <span className="help-note__number">{note.number}.</span>
                          <span className="help-note__text">{note.text}</span>
                          <span className="help-note__place">{note.place}</span>
                        </button>
                      ) : (
                        <span className="help-note">
                          <span className="help-note__number">{note.number}.</span>
                          <span className="help-note__text">{note.text}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="help-section" aria-labelledby="help-mentions-title">
              <h3 className="help-section__title" id="help-mentions-title">
                Упоминается в
              </h3>

              {data.mentions.length === 0 && <p className="help-section__empty">Нет упоминаний</p>}

              {data.mentions.length > 0 && (
                <ul className="help-mentions">
                  {data.mentions.map((mention) => (
                    <li key={`${mention.blockId}-${mention.place}`}>
                      <button
                        type="button"
                        className="help-mention"
                        title={`Перейти: ${mention.blockTitle} — ${mention.place}`}
                        onClick={() => go(mention.href)}
                      >
                        <Icon name={getBlockIcon(mention.blockType)} size={15} />
                        <span>{mentionLabel(mention)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
