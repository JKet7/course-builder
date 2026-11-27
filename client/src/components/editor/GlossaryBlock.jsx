import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../ui/ConfirmModal.jsx';
import Icon from '../ui/Icon.jsx';
import CsvImportModal from '../block/CsvImportModal.jsx';
import TermCard from '../glossary/TermCard.jsx';
import { useInternalLink } from '../content/useInternalLink.js';
import Toolbar from './toolbar/Toolbar.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { useGlossaryStore } from '../../store/glossaryStore.js';
import { csvToTerms, parseCsv } from '../../utils/csv.js';
import { getBlockContentLabel, getTermLetter, sortTerms } from '../../utils/helpers.js';
import { contentBodyToText } from '../../utils/contentBody.js';
import { useOptionalSearchParams } from '../../utils/router.js';

/** Блок «Глоссарий»: термины с определениями, поиск и импорт CSV. */
export default function GlossaryBlock({ block }) {
  const isEditor = useAuthStore((state) => state.isEditor);
  const uiMode = useUiStore((state) => state.uiMode);
  const canEdit = isEditor && uiMode === 'edit';

  // Панель инструментов применяет команды к определению термина в фокусе
  const activeEditor = useEditorStore((state) => state.activeEditor);

  const storeBlockId = useGlossaryStore((state) => state.blockId);
  const terms = useGlossaryStore((state) => state.terms);
  const loading = useGlossaryStore((state) => state.loading);
  const loaded = useGlossaryStore((state) => state.loaded);
  const error = useGlossaryStore((state) => state.error);
  const fetchTerms = useGlossaryStore((state) => state.fetchTerms);
  const addTerm = useGlossaryStore((state) => state.addTerm);
  const updateTerm = useGlossaryStore((state) => state.updateTerm);
  const deleteTerm = useGlossaryStore((state) => state.deleteTerm);
  const importTerms = useGlossaryStore((state) => state.importTerms);

  const [query, setQuery] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  // Внутренняя ссылка (Правка 6): ?term=<id> прокручивает к нужному термину
  const searchParams = useOptionalSearchParams();
  const onInternalLink = useInternalLink();
  const targetTermId = searchParams.get('term');
  const [linkedId, setLinkedId] = useState(null);
  const handledTerm = useRef(null);

  useEffect(() => {
    fetchTerms(block.id);
  }, [block.id, fetchTerms]);

  const sameBlock = storeBlockId === block.id;
  const list = sameBlock ? terms : [];

  const search = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const filtered = search
      ? list.filter(
          (term) =>
            term.term.toLowerCase().includes(search) ||
            contentBodyToText(term.definition, term.id).toLowerCase().includes(search),
        )
      : list;

    // В режиме чтения — алфавит с заголовками букв, в редакторе — порядок создания,
    // чтобы карточка не «уезжала» из-под курсора во время набора.
    return canEdit ? filtered : sortTerms(filtered);
  }, [list, search, canEdit]);

  const groups = useMemo(() => {
    if (canEdit) return [{ letter: null, terms: visible }];

    const buckets = [];
    for (const term of visible) {
      const letter = getTermLetter(term.term);
      const last = buckets[buckets.length - 1];

      if (last && last.letter === letter) last.terms.push(term);
      else buckets.push({ letter, terms: [term] });
    }

    return buckets;
  }, [visible, canEdit]);

  // Указатель по буквам — только в режиме чтения, где есть алфавитные группы.
  const letters = useMemo(
    () => groups.map((group) => group.letter).filter(Boolean),
    [groups],
  );

  // Переход по ссылке: если фильтр скрывает термин — сбрасываем поиск,
  // затем прокручиваем к карточке и подсвечиваем её
  useEffect(() => {
    if (!targetTermId || handledTerm.current === targetTermId) return undefined;
    if (!list.some((term) => term.id === targetTermId)) return undefined;

    if (!visible.some((term) => term.id === targetTermId)) {
      if (query) setQuery('');
      return undefined;
    }

    handledTerm.current = targetTermId;

    const timer = setTimeout(() => {
      document.querySelector(`[data-term-id="${targetTermId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setLinkedId(targetTermId);
    }, 80);

    return () => clearTimeout(timer);
  }, [targetTermId, list, visible, query]);

  useEffect(() => {
    if (!linkedId) return undefined;
    const timer = setTimeout(() => setLinkedId(null), 2400);
    return () => clearTimeout(timer);
  }, [linkedId]);

  const jumpToLetter = (letter) => {
    const target = document.getElementById(`glossary-letter-${letter}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    const value = newTerm.trim();

    if (!value) {
      setActionError('Введите термин');
      return;
    }

    const result = await addTerm(block.id, value);

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    setActionError(null);
    setNewTerm('');
  };

  const handleImport = async (items) => {
    const result = await importTerms(block.id, items);

    if (!result.ok) {
      return { ok: false, message: result.fieldErrors?.terms ?? result.message };
    }

    return { ok: true, created: result.created, message: `Добавлено терминов: ${result.created}` };
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    const result = await deleteTerm(pendingDelete.id);
    setDeleting(false);

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    setPendingDelete(null);
  };

  const showSkeleton = list.length === 0 && (loading || !sameBlock);
  const showEmpty = sameBlock && loaded && !loading && list.length === 0 && !error;

  return (
    <section className="glossary-block">
      {canEdit && <Toolbar editor={activeEditor} />}

      <div className="test-block__bar">
        <div className="test-block__stats">
          <span className="badge badge--purple">
            <Icon name="book" size={14} />
            {getBlockContentLabel('glossary', list.length)}
          </span>
        </div>

        <div className="content-actions">
          <label className="glossary-search">
            <Icon name="search" size={16} />
            <input
              className="input input--sm"
              value={query}
              placeholder="Поиск по терминам"
              aria-label="Поиск по терминам"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Icon name="upload" size={16} />
              Импорт CSV
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{actionError}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => fetchTerms(block.id)}>
            Повторить
          </Button>
        </div>
      )}

      {canEdit && (
        <form className="glossary-new" onSubmit={handleAdd}>
          <input
            className="input"
            value={newTerm}
            placeholder="Новый термин"
            aria-label="Новый термин"
            onChange={(event) => setNewTerm(event.target.value)}
          />
          <Button type="submit" size="sm">
            <Icon name="plus" size={16} />
            Добавить термин
          </Button>
        </form>
      )}

      {showSkeleton && (
        <div className="slide-skeleton" aria-hidden="true">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
        </div>
      )}

      {showEmpty && (
        <div className="empty-state empty-state--center">
          <Icon name="book" size={32} />
          <p className="empty-state__title">Глоссарий пуст</p>
          <p>
            {canEdit
              ? 'Добавьте первый термин или импортируйте список из CSV.'
              : 'Преподаватель ещё не добавил термины.'}
          </p>
        </div>
      )}

      {list.length > 0 && visible.length === 0 && (
        <p className="content-empty">По запросу «{query.trim()}» ничего не найдено.</p>
      )}

      {groups.length > 0 && (
        <div className={`glossary-layout${letters.length > 1 ? '' : ' glossary-layout--plain'}`}>
          {letters.length > 1 && (
            <nav className="glossary-letters" aria-label="Перейти к букве">
              {letters.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className="glossary-letter"
                  aria-label={`Перейти к букве ${letter}`}
                  onClick={() => jumpToLetter(letter)}
                >
                  {letter}
                </button>
              ))}
            </nav>
          )}

          <div className="glossary-groups">
            {groups.map((group) => (
              <div
                key={group.letter ?? 'all'}
                className="glossary-group"
                id={group.letter ? `glossary-letter-${group.letter}` : undefined}
              >
                {group.letter && <h3 className="glossary-group__letter">{group.letter}</h3>}

                <div className="glossary-list">
                  {group.terms.map((term) => (
                    <TermCard
                      key={term.id}
                      term={term}
                      canEdit={canEdit}
                      checklistBlockId={block.id}
                      highlighted={linkedId === term.id}
                      onLinkClick={onInternalLink}
                      onSave={updateTerm}
                      onDelete={() => setPendingDelete(term)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Удалить термин?"
          message={
            <>
              <p className="modal__text">Термин «{pendingDelete.term}» будет удалён вместе с определением.</p>
              <p className="modal__text modal__text--muted">Действие нельзя отменить.</p>
            </>
          }
          loading={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {importOpen && (
        <CsvImportModal
          title="Импорт терминов из CSV"
          hint="Один термин — одна строка. Файл читается локально, в браузере."
          columns="термин; определение"
          parse={(text) => csvToTerms(parseCsv(text).rows)}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
        />
      )}
    </section>
  );
}

