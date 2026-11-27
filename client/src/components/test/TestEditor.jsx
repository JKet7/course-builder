import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../ui/ConfirmModal.jsx';
import Icon from '../ui/Icon.jsx';
import CsvImportModal from '../block/CsvImportModal.jsx';
import QuestionCard from './QuestionCard.jsx';
import SectionCard from './SectionCard.jsx';
import TestSettingsPanel from './TestSettingsPanel.jsx';
import Toolbar from '../editor/toolbar/Toolbar.jsx';
import { useEditorStore } from '../../store/editorStore.js';
import { useTestStore } from '../../store/testStore.js';
import {
  csvToQuestions,
  downloadCsvFile,
  parseCsv,
  questionsToCsv,
  QUESTIONS_CSV_HINT,
  TEST_CSV_TEMPLATES,
} from '../../utils/csv.js';
import { getBlockContentLabel, getQuestionTypeLabel, pluralize, QUESTION_TYPES } from '../../utils/helpers.js';
import { createQuestionPayload } from '../../utils/testDraft.js';
import { buildEditorRows, countSectionQuestions, dragReorder } from '../../utils/testEditor.js';
import { readEditorState, writeEditorState } from '../../utils/testEditorMemory.js';
import { useOptionalSearchParams } from '../../utils/router.js';

/**
 * Режим редактора блока «Тест»: вертикальный список карточек вопросов
 * (как в Google Forms), панель базовых настроек, разделы ветвления,
 * перетаскивание вопросов и правая панель настроек выбранного вопроса.
 *
 * Читатель видит другой интерфейс — TestReader; здесь нет таймера,
 * прогресс-бара и навигационной сетки.
 */
export default function TestEditor({ block }) {
  const activeEditor = useEditorStore((state) => state.activeEditor);

  const storeBlockId = useTestStore((state) => state.blockId);
  const groups = useTestStore((state) => state.groups);
  const sections = useTestStore((state) => state.sections);
  const settings = useTestStore((state) => state.settings);
  const questions = useTestStore((state) => state.questions);
  const loading = useTestStore((state) => state.loading);
  const loaded = useTestStore((state) => state.loaded);
  const error = useTestStore((state) => state.error);
  const fetchAll = useTestStore((state) => state.fetchAll);
  const saveSettings = useTestStore((state) => state.saveSettings);
  const addGroup = useTestStore((state) => state.addGroup);
  const updateGroup = useTestStore((state) => state.updateGroup);
  const deleteGroup = useTestStore((state) => state.deleteGroup);
  const addSection = useTestStore((state) => state.addSection);
  const updateSection = useTestStore((state) => state.updateSection);
  const deleteSection = useTestStore((state) => state.deleteSection);
  const addQuestion = useTestStore((state) => state.addQuestion);
  const updateQuestion = useTestStore((state) => state.updateQuestion);
  const deleteQuestion = useTestStore((state) => state.deleteQuestion);
  const duplicateQuestion = useTestStore((state) => state.duplicateQuestion);
  const reorderQuestions = useTestStore((state) => state.reorderQuestions);

  const sameBlock = storeBlockId === block.id;

  const list = useMemo(() => {
    if (!sameBlock) return [];
    return [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [sameBlock, questions]);

  const counts = useMemo(
    () =>
      list.reduce((acc, question) => {
        if (question.groupId) acc[question.groupId] = (acc[question.groupId] ?? 0) + 1;
        return acc;
      }, {}),
    [list],
  );

  // Состояние редактора переживает переключение режима и перезагрузку страницы.
  const [activeId, setActiveId] = useState(() => readEditorState(block.id).activeId ?? null);
  const [composer, setComposer] = useState({ type: 'single', text: '' });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const [linkedId, setLinkedId] = useState(null);

  const searchParams = useOptionalSearchParams();
  const targetQuestionId = searchParams.get('question');
  const handledQuestion = useRef(null);
  const restored = useRef(false);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
    writeEditorState(block.id, { activeId });
  }, [block.id, activeId]);
  // Вопрос мог быть удалён или переехать в другой блок.
  useEffect(() => {
    if (!activeId || list.length === 0) return;
    if (!list.some((question) => question.id === activeId)) setActiveId(null);
  }, [activeId, list]);

  // Вернулись из читателя — прокручиваем к вопросу, на котором остановились.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const state = readEditorState(block.id);
    if (!state.activeId && !state.scrollY) return undefined;

    const timer = setTimeout(() => {
      if (state.activeId) {
        document.querySelector(`[data-question-id="${state.activeId}"]`)?.scrollIntoView({ block: 'center' });
      } else if (state.scrollY) {
        window.scrollTo({ top: state.scrollY });
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [block.id]);

  // Прокрутку запоминаем между переключениями режимов (запись с задержкой,
  // чтобы не трогать localStorage на каждое событие скролла).
  useEffect(() => {
    let timer = null;

    const storeScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        writeEditorState(block.id, { activeId: activeIdRef.current, scrollY: Math.round(window.scrollY) });
      }, 200);
    };

    window.addEventListener('scroll', storeScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      writeEditorState(block.id, { activeId: activeIdRef.current, scrollY: Math.round(window.scrollY) });
      window.removeEventListener('scroll', storeScroll);
    };
  }, [block.id]);

  // Панель настроек закрывается при клике вне карточки вопроса.
  useEffect(() => {
    if (!activeId) return undefined;

    const handleDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.question-card') || target.closest('.question-settings')) return;

      setActiveId(null);
    };

    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [activeId]);

  // Внутренняя ссылка ?question=<id> открывает нужный вопрос в редакторе.
  useEffect(() => {
    if (!targetQuestionId || handledQuestion.current === targetQuestionId) return undefined;
    if (!list.some((question) => question.id === targetQuestionId)) return undefined;

    handledQuestion.current = targetQuestionId;
    setActiveId(targetQuestionId);

    const timer = setTimeout(() => {
      document
        .querySelector(`[data-question-id="${targetQuestionId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setLinkedId(targetQuestionId);
    }, 80);

    return () => clearTimeout(timer);
  }, [targetQuestionId, list]);

  useEffect(() => {
    if (!linkedId) return undefined;
    const timer = setTimeout(() => setLinkedId(null), 2400);
    return () => clearTimeout(timer);
  }, [linkedId]);

  const handleSettings = async (patch) => {
    setActionError(null);
    const result = await saveSettings(block.id, patch);
    if (!result.ok) setActionError(result.message);
  };

  const handleAddGroup = async (name) => {
    setActionError(null);
    const result = await addGroup(block.id, name);
    if (!result.ok) setActionError(result.message);
  };

  const handleRenameGroup = async (groupId, name) => {
    setActionError(null);
    const result = await updateGroup(groupId, name);
    if (!result.ok) setActionError(result.message);
  };

  // Новый раздел — точка ветвления. Если он добавлен между вопросами,
  // следующий вопрос сразу попадает в этот раздел.
  const handleAddSection = async (afterQuestionId = null) => {
    setActionError(null);
    const result = await addSection(block.id, 'Новый раздел');

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    if (!afterQuestionId) return;

    const index = list.findIndex((question) => question.id === afterQuestionId);
    const next = index === -1 ? null : list[index + 1];
    if (next) await updateQuestion(next.id, { sectionId: result.section.id });
  };

  const handleRenameSection = async (sectionId, title) => {
    setActionError(null);
    const result = await updateSection(sectionId, { title });
    if (!result.ok) setActionError(result.message);
  };

  const handleSectionResult = async (sectionId, result) => {
    const response = await updateSection(sectionId, { result });
    if (!response.ok) setActionError(response.message);
  };

  // Раздел вопроса меняется отдельным запросом: черновик карточки не должен
  // перетирать его при следующем автосохранении.
  const handleSectionChange = async (questionId, sectionId) => {
    setActionError(null);
    const result = await updateQuestion(questionId, { sectionId });
    if (!result.ok) setActionError(result.message);
  };

  const handleAddQuestion = async (event) => {
    event.preventDefault();
    const text = composer.text.trim();

    if (!text) {
      setActionError('Введите текст вопроса');
      return;
    }

    const result = await addQuestion(block.id, createQuestionPayload(composer.type, text, null));

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    setActionError(null);
    setComposer({ type: composer.type, text: '' });
    setActiveId(result.question.id);

    setTimeout(() => {
      document.querySelector(`[data-question-id="${result.question.id}"]`)?.scrollIntoView({ block: 'center' });
    }, 80);
  };

  const handleDuplicate = async (question) => {
    setActionError(null);
    const result = await duplicateQuestion(block.id, question.id);

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    if (result.question?.id) setActiveId(result.question.id);
  };

  // Экспорт текущего блока в формате шаблонов: правка в Excel и обратный импорт.
  const handleExport = () => {
    if (list.length === 0) return;
    downloadCsvFile('Тест.csv', questionsToCsv(list));
  };

  const handleImport = async (items) => {
    let created = 0;
    const failures = [];

    // Группа из колонки «Группа»: находим по имени или создаём новую.
    const groupCache = new Map(groups.map((group) => [group.name.trim().toLowerCase(), group.id]));

    const resolveGroupId = async (name) => {
      const key = String(name ?? '').trim().toLowerCase();
      if (!key) return null;
      if (groupCache.has(key)) return groupCache.get(key);

      const result = await addGroup(block.id, String(name).trim());

      if (!result.ok) {
        failures.push(`Группа «${name}»: ${result.message}`);
        return null;
      }

      groupCache.set(key, result.group.id);
      return result.group.id;
    };

    for (const item of items) {
      const groupId = item.group ? await resolveGroupId(item.group) : null;

      const result = await addQuestion(block.id, {
        type: item.type,
        data: item.data,
        options: item.options ?? [],
        pairs: item.pairs ?? [],
        explanation: item.explanation ?? null,
        groupId,
      });

      if (result.ok) created += 1;
      else failures.push(`Строка ${item.line}: ${result.message}`);
    }

    return {
      ok: created > 0,
      created,
      message: created
        ? `Импортировано вопросов: ${created}${failures.length ? `, с ошибками: ${failures.length}` : ''}`
        : failures[0] ?? 'Не удалось импортировать ни одного вопроса',
    };
  };

  // Предпросмотр импорта: тип, текст и группа каждой распознанной строки.
  const previewImport = (items) =>
    items.map((item) => {
      const text = String(item.data?.text ?? item.data?.front ?? '').trim();
      const short = text.length > 70 ? `${text.slice(0, 70)}…` : text;
      const parts = [getQuestionTypeLabel(item.type), short || 'Без текста'];

      if (item.options?.length) parts.push(`${item.options.length} вар.`);
      if (item.pairs?.length) parts.push(`${item.pairs.length} пары`);
      if (item.group) parts.push(`группа «${item.group}»`);

      return parts.join(' · ');
    });

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(true);

    const result =
      pendingDelete.kind === 'group'
        ? await deleteGroup(pendingDelete.item.id)
        : pendingDelete.kind === 'section'
          ? await deleteSection(pendingDelete.item.id)
          : await deleteQuestion(pendingDelete.item.id);

    setDeleting(false);

    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    if (pendingDelete.kind === 'question' && activeId === pendingDelete.item.id) setActiveId(null);
    setPendingDelete(null);
  };

  const handleDragStart = (questionId) => (event) => {
    setDragId(questionId);
    event.dataTransfer?.setData('text/plain', questionId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (questionId) => (event) => {
    if (!dragId || dragId === questionId) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dropId !== questionId) setDropId(questionId);
  };

  const handleDrop = (targetId) => (event) => {
    event.preventDefault();

    const source = dragId ?? event.dataTransfer?.getData('text/plain');
    setDragId(null);
    setDropId(null);

    const ids = dragReorder(
      list.map((question) => question.id),
      source,
      targetId,
    );

    if (ids) reorderQuestions(block.id, ids);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropId(null);
  };

  const branching = Boolean(settings.branching);
  const rows = useMemo(
    () => buildEditorRows(list, branching ? sections : []),
    [list, branching, sections],
  );

  const showSkeleton = list.length === 0 && (loading || !sameBlock);
  const showEmpty = sameBlock && loaded && !loading && list.length === 0 && !error;

  const deleteTitle =
    pendingDelete?.kind === 'group'
      ? 'Удалить группу?'
      : pendingDelete?.kind === 'section'
        ? 'Удалить раздел?'
        : 'Удалить вопрос?';

  return (
    <section className="test-block test-editor">
      <Toolbar editor={activeEditor} />
      <div className="test-block__bar">
        <div className="test-block__stats">
          <span className="badge badge--green">
            <Icon name="clipboard" size={14} />
            {getBlockContentLabel('test', list.length)}
          </span>
          <span className="badge badge--gray">
            <Icon name="layers" size={14} />
            {groups.length} {pluralize(groups.length, ['группа', 'группы', 'групп'])}
          </span>
          {branching && (
            <span className="badge badge--gray">
              <Icon name="listTree" size={14} />
              {sections.length} {pluralize(sections.length, ['раздел', 'раздела', 'разделов'])}
            </span>
          )}
        </div>

        <span className="test-editor__hint">
          <Icon name="grip" size={14} />
          Карточки можно перетаскивать
        </span>
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
          <Button variant="ghost" size="sm" onClick={() => fetchAll(block.id)}>
            Повторить
          </Button>
        </div>
      )}

      <TestSettingsPanel
        settings={settings}
        groups={groups}
        sections={sections}
        counts={counts}
        sectionsEnabled={branching}
        onSettings={handleSettings}
        onAddGroup={handleAddGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={(group) => setPendingDelete({ kind: 'group', item: group })}
        onAddSection={handleAddSection}
        onRenameSection={handleRenameSection}
        onDeleteSection={(section) => setPendingDelete({ kind: 'section', item: section })}
        onExport={handleExport}
        onImport={() => setImportOpen(true)}
        canExport={list.length > 0}
      />

      <div className="test-editor__list">
        {showSkeleton && (
          <div className="slide-skeleton" aria-hidden="true">
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" />
          </div>
        )}

        {showEmpty && (
          <div className="empty-state empty-state--center">
            <Icon name="clipboard" size={32} />
            <p className="empty-state__title">Вопросов пока нет</p>
            <p>Добавьте первый вопрос в форме ниже или импортируйте список из CSV.</p>
          </div>
        )}

        {rows.map((row) =>
          row.kind === 'section' ? (
            <SectionCard
              key={row.key}
              section={row.section}
              count={countSectionQuestions(list, row.section.id)}
              onRename={handleRenameSection}
              onDelete={(section) => setPendingDelete({ kind: 'section', item: section })}
              onResultChange={handleSectionResult}
            />
          ) : (
            <div
              key={row.key}
              className={`question-slot${linkedId === row.question.id ? ' is-link-target' : ''}`}
              onDragOver={handleDragOver(row.question.id)}
              onDrop={handleDrop(row.question.id)}
            >
              <QuestionCard
                question={row.question}
                index={row.number - 1}
                groups={groups}
                sections={sections}
                settings={settings}
                active={activeId === row.question.id}
                dragging={dragId === row.question.id}
                dropTarget={dropId === row.question.id}
                onActivate={() => setActiveId(row.question.id)}
                onDeactivate={() => setActiveId(null)}
                onSave={updateQuestion}
                onDuplicate={() => handleDuplicate(row.question)}
                onDelete={() => setPendingDelete({ kind: 'question', item: row.question })}
                onSectionChange={(sectionId) => handleSectionChange(row.question.id, sectionId)}
                onDragStart={handleDragStart(row.question.id)}
                onDragEnd={handleDragEnd}
              />

              {branching && (
                <div className="test-section-add">
                  <button
                    type="button"
                    className="test-section-add__btn"
                    onClick={() => handleAddSection(row.question.id)}
                  >
                    <Icon name="plus" size={14} />
                    Добавить раздел
                  </button>
                </div>
              )}
            </div>
          ),
        )}

        <form className="question-new" onSubmit={handleAddQuestion}>
          <select
            className="tool-select"
            value={composer.type}
            aria-label="Тип нового вопроса"
            onChange={(event) => setComposer({ ...composer, type: event.target.value })}
          >
            {QUESTION_TYPES.map((item) => (
              <option key={item.type} value={item.type}>
                {item.label}
              </option>
            ))}
          </select>

          <input
            className="input"
            value={composer.text}
            placeholder={composer.type === 'card' ? 'Лицевая сторона карточки' : 'Текст нового вопроса'}
            aria-label="Текст нового вопроса"
            onChange={(event) => setComposer({ ...composer, text: event.target.value })}
          />

          <Button type="submit" size="sm">
            <Icon name="plus" size={16} />
            Добавить вопрос
          </Button>
        </form>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title={deleteTitle}
          message={
            pendingDelete.kind === 'group' ? (
              <>
                <p className="modal__text">
                  Группа «{pendingDelete.item.name}» будет удалена. Вопросы останутся в блоке без группы.
                </p>
                <p className="modal__text modal__text--muted">Действие нельзя отменить.</p>
              </>
            ) : pendingDelete.kind === 'section' ? (
              <>
                <p className="modal__text">
                  Раздел «{pendingDelete.item.title}» будет удалён. Вопросы останутся в блоке, а переходы в
                  этот раздел станут обычным «следующий вопрос».
                </p>
                <p className="modal__text modal__text--muted">Действие нельзя отменить.</p>
              </>
            ) : (
              <>
                <p className="modal__text">Вопрос будет удалён вместе с вариантами и пояснением.</p>
                <p className="modal__text modal__text--muted">Действие нельзя отменить.</p>
              </>
            )
          }
          loading={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {importOpen && (
        <CsvImportModal
          title="Импорт вопросов из CSV"
          hint={QUESTIONS_CSV_HINT}
          columns="Вопрос; Вариант 1 … 12; Правильный ответ; Объяснение; Группа — или Карточки / Соответствие"
          templates={TEST_CSV_TEMPLATES}
          parse={(text) => csvToQuestions(parseCsv(text).rows)}
          preview={previewImport}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
        />
      )}
    </section>
  );
}

