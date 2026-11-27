import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { useInternalLink } from '../content/useInternalLink.js';
import ReaderNavigation from './ReaderNavigation.jsx';
import ReaderQuestion from './ReaderQuestion.jsx';
import ReaderResults from './ReaderResults.jsx';
import { useBlockStore } from '../../store/blockStore.js';
import { useTestStore } from '../../store/testStore.js';
import {
  answerValue,
  branchAnswer,
  branchNextId,
  branchPath,
  canSubmit,
  computeResults,
  createRun,
  elapsedSeconds,
  finishRun,
  flaggedCount,
  formatDuration,
  gradeAnswer,
  isFlagged,
  isResolved,
  orderedQuestions,
  pauseRun,
  readRun,
  reconcileRun,
  resetBranch,
  resumeRun,
  runProgress,
  toggleFlag as toggleRunFlag,
  writeRun,
} from '../../utils/testRun.js';
import { useOptionalSearchParams } from '../../utils/router.js';
import { writeEditorState } from '../../utils/testEditorMemory.js';

/**
 * Режим читателя блока «Тест»: прохождение по одному вопросу.
 *
 * В тесте с оценкой слева — вопрос, снизу — «Назад / Дальше», справа — сетка
 * навигации со статусами вопросов. Выбор варианта ничего не проверяет: читатель
 * может менять его до кнопки «Готово» в правом нижнем углу вопроса, и только она
 * фиксирует ответ и запускает проверку. Флажок «Вернуться позже» в углу вопроса
 * помечает его для возврата: в навигации такая ячейка получает красный
 * треугольник.
 *
 * В режиме ветвления панели навигации нет: вопросы идут строго последовательно,
 * а следующий зависит от выбранного варианта. Ответ фиксирует «Дальше» — до
 * выбора кнопка неактивна. «Назад» возвращает по пройденному пути (`run.path`);
 * смена ответа на предыдущем вопросе пересобирает ветку и предупреждает об этом.
 * Шапка показывает только номер текущего вопроса: длина пути заранее неизвестна.
 *
 * Попытка (порядок вопросов и вариантов, ответы, черновики, метки, путь, таймер)
 * хранится в localStorage и переживает перезагрузку. Каждый вход в читателя
 * ставит таймер на паузу при уходе и возобновляет при возврате; после завершения
 * показывается экран итогов.
 */
export default function TestReader({ block }) {
  const storeBlockId = useTestStore((state) => state.blockId);
  const questions = useTestStore((state) => state.questions);
  const sections = useTestStore((state) => state.sections);
  const settings = useTestStore((state) => state.settings);
  const loading = useTestStore((state) => state.loading);
  const loaded = useTestStore((state) => state.loaded);
  const error = useTestStore((state) => state.error);
  const errorKind = useTestStore((state) => state.errorKind);
  const fetchAll = useTestStore((state) => state.fetchAll);

  const blocks = useBlockStore((state) => state.blocks);
  const blocksCourseId = useBlockStore((state) => state.courseId);
  const fetchBlocks = useBlockStore((state) => state.fetchBlocks);

  const sameBlock = storeBlockId === block.id;
  const storeQuestions = sameBlock ? questions : [];
  const ordered = useMemo(() => orderedQuestions(storeQuestions, sections), [storeQuestions, sections]);

  const courseId = block.courseId ?? block.course?.id ?? null;

  /** Сохранённая попытка: досчитываем путь и сразу возобновляем таймер. */
  const loadRun = () => {
    const stored = readRun(block.id);
    return stored
      ? resumeRun(reconcileRun(stored, ordered, settings), Date.now())
      : createRun(block.id, ordered, settings);
  };

  const [run, setRun] = useState(() => (sameBlock && ordered.length > 0 ? loadRun() : null));
  const [now, setNow] = useState(() => Date.now());
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [branchNotice, setBranchNotice] = useState(false);

  const searchParams = useOptionalSearchParams();
  const onInternalLink = useInternalLink();
  const targetQuestionId = searchParams.get('question');
  const handledQuestion = useRef(null);
  const resumed = useRef(false);
  const runRef = useRef(run);

  const activeRun = run && run.blockId === block.id ? run : null;

  // Режим ветвления — тест без оценки: верных и неверных ответов нет, а панель
  // навигации скрыта — путь задают только ответы читателя.
  const branching = Boolean(settings?.branching);
  const graded = !branching;

  // Смена блока или состава вопросов: сверяем попытку, новую создаём при старте.
  useEffect(() => {
    if (!sameBlock || ordered.length === 0) {
      setRun(null);
      return;
    }

    setRun((previous) => {
      if (previous && previous.blockId === block.id) return reconcileRun(previous, ordered, settings);

      const stored = readRun(block.id);
      return stored
        ? resumeRun(reconcileRun(stored, ordered, settings), Date.now())
        : createRun(block.id, ordered, settings);
    });
  }, [block.id, sameBlock, ordered, settings]);

  // Загрузка списка блоков нужна кнопке «Следующий блок» на экране итогов.
  useEffect(() => {
    if (courseId && blocksCourseId !== courseId) fetchBlocks(courseId);
  }, [courseId, blocksCourseId, fetchBlocks]);

  // Таймер идёт, только пока тест не завершён и не поставлен на паузу.
  const isRunning = Boolean(activeRun && activeRun.running && !activeRun.finished);

  useEffect(() => {
    if (!isRunning) return undefined;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  // Черновик попытки пишем на каждое изменение: перезагрузка не теряет ответы.
  useEffect(() => {
    if (!activeRun || activeRun.blockId !== block.id) return;
    writeRun(block.id, activeRun);
  }, [block.id, activeRun]);

  useEffect(() => {
    runRef.current = activeRun;
  }, [activeRun]);

  // Уход из читателя (переключение в редактор или другой блок) — пауза.
  useEffect(
    () => () => {
      const current = runRef.current;
      if (current && current.blockId === block.id && !current.finished) {
        writeRun(block.id, pauseRun(current));
      }
    },
    [block.id],
  );

  // Один раз за визит возобновляем таймер приостановленной попытки.
  useEffect(() => {
    resumed.current = false;
  }, [block.id]);

  useEffect(() => {
    if (!activeRun || resumed.current) return;
    resumed.current = true;
    if (!activeRun.finished && !activeRun.running) setRun((previous) => resumeRun(previous));
  }, [activeRun]);

  // Текущий вопрос запоминаем для редактора: переключение откроет эту карточку.
  useEffect(() => {
    if (activeRun?.currentId) writeEditorState(block.id, { activeId: activeRun.currentId });
  }, [block.id, activeRun?.currentId]);

  // Внутренняя ссылка ?question=... открывает нужный вопрос. В ветвлении
  // прыгать нельзя: путь задают только ответы, поэтому ссылку игнорируем.
  useEffect(() => {
    if (branching) return;
    if (!activeRun || activeRun.finished || !targetQuestionId) return;
    if (handledQuestion.current === targetQuestionId) return;
    if (!activeRun.sequence.includes(targetQuestionId)) return;

    handledQuestion.current = targetQuestionId;
    setRun((previous) =>
      previous && previous.currentId !== targetQuestionId
        ? { ...previous, currentId: targetQuestionId }
        : previous,
    );
  }, [activeRun, targetQuestionId, branching]);

  // В ветвлении вопросы идут по пройденному пути, в тесте с оценкой — по всей
  // последовательности попытки.
  const pathIds = useMemo(
    () => (branching ? branchPath(activeRun) : activeRun?.sequence ?? []),
    [branching, activeRun?.path, activeRun?.sequence],
  );

  const sequenceQuestions = useMemo(() => {
    const byId = new Map(ordered.map((question) => [question.id, question]));
    return pathIds.map((id) => byId.get(id)).filter(Boolean);
  }, [pathIds, ordered]);

  const currentIndex = sequenceQuestions.findIndex((question) => question.id === activeRun?.currentId);
  const position = currentIndex >= 0 ? currentIndex : 0;
  const currentQuestion = sequenceQuestions[position] ?? null;
  const currentAnswer = currentQuestion ? activeRun?.answers?.[currentQuestion.id] : null;
  const currentDraft = currentQuestion ? activeRun?.picks?.[currentQuestion.id] : null;
  const resolved = isResolved(currentAnswer);

  // «Дальше» в ветвлении фиксирует ответ, поэтому ждёт выбора варианта.
  const branchValue = answerValue(currentQuestion, currentAnswer, currentDraft);
  const branchReady = Boolean(currentQuestion) && (resolved || canSubmit(currentQuestion, branchValue));
  const flaggedNow = isFlagged(activeRun, currentQuestion?.id);
  const flagTotal = flaggedCount(activeRun);

  // Подсказка подвала: в тесте с оценкой ответ фиксирует «Готово», в ветвлении —
  // «Дальше», а пройденный ответ можно изменить (путь пересоберётся).
  const footerHint = branching
    ? resolved
      ? 'Ответ можно изменить — следующие вопросы ветки пересоберутся'
      : currentQuestion?.type === 'card'
        ? 'Нажмите «Знаю» или «Не знаю», затем «Дальше»'
        : 'Выберите вариант и нажмите «Дальше»'
    : resolved
      ? 'Ответ зафиксирован'
      : currentQuestion?.type === 'card'
        ? 'Нажмите «Знаю» или «Не знаю», чтобы продолжить'
        : 'Выберите вариант и нажмите «Готово»';

  const progress = useMemo(
    () => runProgress({ sequence: pathIds, answers: activeRun?.answers }),
    [pathIds, activeRun?.answers],
  );
  const elapsed = elapsedSeconds(activeRun, now);

  const nextBlock = useMemo(() => {
    if (!courseId || blocksCourseId !== courseId) return null;

    const sorted = [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = sorted.findIndex((item) => item.id === block.id);
    return index >= 0 ? sorted[index + 1] ?? null : null;
  }, [blocks, blocksCourseId, courseId, block.id]);

  const scrollTop = () => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goTo = (questionId) => {
    setConfirmFinish(false);
    setBranchNotice(false);
    setRun((previous) => (previous ? { ...previous, currentId: questionId } : previous));
    scrollTop();
  };

  /**
   * «Дальше». В ветвлении эта же кнопка фиксирует ответ (оценки нет) и выбирает
   * следующий вопрос по варианту; когда цель — «Отправить форму» или вопросы
   * кончились, показывается итоговая страница. В тесте с оценкой ответ уже
   * зафиксирован кнопкой «Готово», поэтому шаг — просто следующий вопрос.
   */
  const goNext = () => {
    if (!activeRun || !currentQuestion) return;

    if (branching) {
      if (!branchReady) return;

      setRun((previous) => {
        if (!previous || previous.finished) return previous;

        const id = currentQuestion.id;
        const value = answerValue(currentQuestion, previous.answers?.[id], previous.picks?.[id]);
        if (!canSubmit(currentQuestion, value)) return previous;

        // Ответ записывается в попытку; при смене ответа путь уже обрезан.
        const withAnswer = branchAnswer(previous, currentQuestion, value);
        const targetId = branchNextId({
          run: withAnswer,
          question: currentQuestion,
          questions: ordered,
          settings,
        });

        // Шаг вперёд снова обрезает путь до текущего вопроса: возврат назад мог
        // оставить «хвост» из уже пройденных вопросов.
        const path = branchPath(withAnswer);
        const index = path.indexOf(id);
        const walked = index >= 0 ? path.slice(0, index + 1) : [...path, id];

        const picks = { ...withAnswer.picks };
        delete picks[id];

        const next = { ...withAnswer, picks, path: walked };
        if (!targetId) return finishRun(next);

        return { ...next, path: [...walked, targetId], currentId: targetId };
      });
      setConfirmFinish(false);
      setBranchNotice(false);
      scrollTop();
      return;
    }

    if (!resolved) return;

    const index = activeRun.sequence.indexOf(currentQuestion.id);
    const targetId = index >= 0 ? activeRun.sequence[index + 1] ?? null : null;

    if (!targetId) {
      setRun((previous) => (previous ? finishRun(previous) : previous));
      setConfirmFinish(false);
      scrollTop();
      return;
    }

    goTo(targetId);
  };

  /**
   * Ответ карточки: «Знаю / Не знаю» — это и есть ответ. В тесте с оценкой он
   * проверяется сразу, в ветвлении только записывается, а смена стороны
   * пересобирает путь (предупреждение показывает подвал).
   */
  const answerQuestion = (value) => {
    if (!currentQuestion) return;

    const id = currentQuestion.id;
    const stored = activeRun?.answers?.[id];

    setRun((previous) => {
      if (!previous || previous.finished) return previous;
      if (branching) return branchAnswer(previous, currentQuestion, value);
      if (isResolved(previous.answers?.[id])) return previous;

      const picks = { ...previous.picks };
      delete picks[id];

      return {
        ...previous,
        answers: {
          ...previous.answers,
          [id]: { ...gradeAnswer(currentQuestion, value, graded), at: Date.now() },
        },
        picks,
      };
    });

    if (branching && stored && (stored.know ?? null) !== (value.know ?? null)) setBranchNotice(true);
  };

  /**
   * Выбор варианта — черновик попытки, вердикта он не выносит. В ветвлении выбор
   * на уже отвеченном вопросе означает смену ответа: путь обрезается до него,
   * а следующие вопросы читатель проходит заново.
   */
  const draftAnswer = (value) => {
    if (!currentQuestion) return;

    const id = currentQuestion.id;
    const rebuild = branching && isResolved(activeRun?.answers?.[id]);
    if (rebuild) setBranchNotice(true);

    setRun((previous) => {
      if (!previous || previous.finished) return previous;
      if (rebuild) return resetBranch(previous, id, value);
      if (isResolved(previous.answers?.[id])) return previous;

      return {
        ...previous,
        picks: {
          ...previous.picks,
          [id]: { ...(previous.picks?.[id] ?? {}), ...value },
        },
      };
    });
  };

  const togglePause = () => {
    setRun((previous) => {
      if (!previous || previous.finished) return previous;
      return previous.running ? pauseRun(previous) : resumeRun(previous);
    });
  };

  /** Флажок «Вернуться позже»: отметка в попытке, ответ и таймер не меняются. */
  const toggleCurrentFlag = () => {
    if (!currentQuestion) return;

    setRun((previous) => {
      if (!previous || previous.finished) return previous;
      return toggleRunFlag(previous, currentQuestion.id);
    });
  };

  const finish = () => {
    setConfirmFinish(false);
    setBranchNotice(false);
    setRun((previous) => (previous ? finishRun(previous) : previous));
    scrollTop();
  };

  const requestFinish = () => {
    if (!activeRun) return;
    if (progress.answered >= progress.total) finish();
    else setConfirmFinish(true);
  };

  const restart = () => {
    setConfirmFinish(false);
    setBranchNotice(false);
    resumed.current = true;
    setRun(createRun(block.id, ordered, settings));
    scrollTop();
  };

  if (!sameBlock && loading) {
    return (
      <section className="test-block test-reader">
        <div className="slide-skeleton" aria-hidden="true">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--line" />
        </div>
      </section>
    );
  }

  // Ошибка загрузки теста. Сервер мог просто не ответить (перезапуск, нет
  // связи) — это временное состояние, поэтому показываем спокойную плашку с
  // повтором, а красный алерт оставляем для ответа сервера (4xx).
  if (error) {
    const unavailable = errorKind === 'offline' || errorKind === 'server';

    return (
      <section className="test-block test-reader">
        <div className={`alert ${unavailable ? 'alert--warn' : 'alert--error'}`} role="alert">
          <Icon name="alert" size={18} />
          <span className="alert__text">
            {error}
            {unavailable && (
              <span className="alert__hint">
                Если сервер перезапускается, подождите пару секунд и нажмите «Повторить».
              </span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => fetchAll(block.id)} disabled={loading}>
            Повторить
          </Button>
        </div>
      </section>
    );
  }

  if (sameBlock && loaded && !loading && ordered.length === 0) {
    return (
      <section className="test-block test-reader">
        <div className="empty-state empty-state--center">
          <Icon name="clipboard" size={32} />
          <p className="empty-state__title">Вопросов пока нет</p>
          <p>Преподаватель ещё не добавил вопросы в этот тест.</p>
        </div>
      </section>
    );
  }

  if (!activeRun || !currentQuestion) {
    return (
      <section className="test-block test-reader">
        <div className="slide-skeleton" aria-hidden="true">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--line" />
        </div>
      </section>
    );
  }

  if (activeRun.finished) {
    const results = computeResults({ questions: ordered, run: activeRun, sections, settings });

    return (
      <section className="test-block test-reader">
        <ReaderResults block={block} results={results} nextBlock={nextBlock} onRestart={restart} />
      </section>
    );
  }

  const previousId = position > 0 ? sequenceQuestions[position - 1]?.id : null;

  return (
    <section className="test-block test-reader">
      <header className="test-run__head">
        <div className="test-run__heading">
          <span className={`test-run__timer${isRunning ? '' : ' is-paused'}`}>
            <span>Время</span>
            <strong>{formatDuration(elapsed)}</strong>
          </span>

          <Button variant="ghost" size="sm" onClick={togglePause}>
            {isRunning ? 'Пауза' : 'Продолжить'}
          </Button>
        </div>

        {branching ? (
          <p className="test-run__step">
            <span>Вопрос</span>
            <strong>{position + 1}</strong>
            <span className="test-run__step-hint">дальше — по выбранной ветке</span>
          </p>
        ) : (
          <div className="test-run__progress-wrap">
            <div className="test-run__progress-meta">
              <span>
                Вопрос {position + 1} из {progress.total}
              </span>
              <span>
                Отвечено {progress.answered} из {progress.total}
              </span>
            </div>

            <div
              className="test-run__progress"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Прогресс теста"
            >
              <span style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
      </header>

      {!isRunning && (
        <div className="test-run__paused" role="status">
          <div>
            <strong>Тест на паузе</strong>
            <span>Таймер остановлен, ответы сохранены.</span>
          </div>
          <Button size="sm" onClick={togglePause}>
            Продолжить
          </Button>
        </div>
      )}

      <div className={`test-run__layout${branching ? ' test-run__layout--single' : ''}`}>
        <div className="test-run__main">
          <ReaderQuestion
            question={currentQuestion}
            index={position}
            total={branching ? null : sequenceQuestions.length}
            answer={currentAnswer}
            draft={currentDraft}
            optionOrder={activeRun.optionOrder?.[currentQuestion.id]}
            pairOrder={activeRun.pairOrder?.[currentQuestion.id]}
            graded={graded}
            flagged={flaggedNow}
            onSubmit={answerQuestion}
            onDraft={draftAnswer}
            onToggleFlag={branching ? undefined : toggleCurrentFlag}
            onLinkClick={onInternalLink}
          />

          {branchNotice && (
            <p className="test-run__notice" role="status">
              Ответ изменён — следующие вопросы ветки начнутся заново.
            </p>
          )}

          <div className="test-run__footer">
            <Button variant="ghost" onClick={() => goTo(previousId)} disabled={!previousId}>
              <Icon name="arrowLeft" size={16} />
              Назад
            </Button>

            <span className="test-run__footer-hint">{footerHint}</span>

            <Button onClick={goNext} disabled={branching ? !branchReady : !resolved}>
              Дальше
              <Icon name="arrowRight" size={16} />
            </Button>
          </div>
        </div>

        {/* В ветвлении панели навигации нет: перепрыгнуть вопрос нельзя. */}
        {!branching && (
          <aside className="test-run__side" aria-label="Навигация по вопросам">
            <div className="test-run__side-head">
              <h2 className="test-run__side-title">Навигация</h2>
              <span className="test-run__side-count">
                {progress.answered}/{progress.total}
              </span>
            </div>

            <ReaderNavigation
              questions={sequenceQuestions}
              currentId={currentQuestion.id}
              answers={activeRun.answers}
              flags={activeRun.flags}
              graded={graded}
              onSelect={goTo}
            />

            {flagTotal > 0 && (
              <p className="test-run__flags" role="status">
                <span className="test-run__flags-mark" aria-hidden="true" />
                Отмечено для возврата: {flagTotal}
              </p>
            )}

            <Button variant="secondary" className="test-run__finish" onClick={requestFinish}>
              Завершить тест
            </Button>

            {confirmFinish && (
              <div className="test-run__confirm" role="alertdialog" aria-label="Завершение теста">
                <p>
                  Завершить тест? Отвечено {progress.answered} из {progress.total}.
                </p>
                <div className="test-run__confirm-actions">
                  <Button size="sm" onClick={finish}>
                    Завершить
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmFinish(false)}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
