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
  computeResults,
  createRun,
  elapsedSeconds,
  finishRun,
  flaggedCount,
  formatDuration,
  gradeAnswer,
  isFlagged,
  isResolved,
  nextQuestionId,
  orderedQuestions,
  pauseRun,
  readRun,
  reconcileRun,
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
 * Слева — вопрос, снизу — «Назад / Дальше», справа — сетка навигации со
 * статусами вопросов. Выбор варианта ничего не проверяет: читатель может менять
 * его до кнопки «Готово» в правом нижнем углу вопроса, и только она фиксирует
 * ответ и запускает проверку. В режиме ветвления выбор ведёт читателя по пути
 * (оценки нет). Флажок «Вернуться позже» в углу вопроса помечает его для
 * возврата: в навигации такая ячейка получает красный треугольник. Попытка
 * (порядок вопросов и вариантов, ответы, черновики, метки, таймер) хранится в
 * localStorage и переживает перезагрузку. Каждый вход в читателя ставит таймер
 * на паузу при уходе и возобновляет при возврате; после завершения показывается
 * экран итогов.
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

  const searchParams = useOptionalSearchParams();
  const onInternalLink = useInternalLink();
  const targetQuestionId = searchParams.get('question');
  const handledQuestion = useRef(null);
  const resumed = useRef(false);
  const runRef = useRef(run);

  const activeRun = run && run.blockId === block.id ? run : null;

  // Режим ветвления — тест без оценки: верных и неверных ответов нет.
  const graded = !settings?.branching;

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

  // Внутренняя ссылка ?question=... открывает нужный вопрос.
  useEffect(() => {
    if (!activeRun || activeRun.finished || !targetQuestionId) return;
    if (handledQuestion.current === targetQuestionId) return;
    if (!activeRun.sequence.includes(targetQuestionId)) return;

    handledQuestion.current = targetQuestionId;
    setRun((previous) =>
      previous && previous.currentId !== targetQuestionId
        ? { ...previous, currentId: targetQuestionId }
        : previous,
    );
  }, [activeRun, targetQuestionId]);

  const sequenceQuestions = useMemo(() => {
    const byId = new Map(ordered.map((question) => [question.id, question]));
    return (activeRun?.sequence ?? []).map((id) => byId.get(id)).filter(Boolean);
  }, [activeRun?.sequence, ordered]);

  const currentIndex = sequenceQuestions.findIndex((question) => question.id === activeRun?.currentId);
  const position = currentIndex >= 0 ? currentIndex : 0;
  const currentQuestion = sequenceQuestions[position] ?? null;
  const currentAnswer = currentQuestion ? activeRun?.answers?.[currentQuestion.id] : null;
  const resolved = isResolved(currentAnswer);
  const flaggedNow = isFlagged(activeRun, currentQuestion?.id);
  const flagTotal = flaggedCount(activeRun);

  // Подсказка подвала: ответ фиксируется кнопкой «Готово» (у карточки — своими кнопками).
  const footerHint = resolved
    ? 'Ответ зафиксирован'
    : currentQuestion?.type === 'card'
      ? 'Нажмите «Знаю» или «Не знаю», чтобы продолжить'
      : 'Выберите вариант и нажмите «Готово»';

  const progress = useMemo(() => runProgress(activeRun), [activeRun]);
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
    setRun((previous) => (previous ? { ...previous, currentId: questionId } : previous));
    scrollTop();
  };

  const goNext = () => {
    if (!activeRun || !currentQuestion || !resolved) return;

    const nextId = nextQuestionId({
      sequence: activeRun.sequence,
      currentId: currentQuestion.id,
      questions: ordered,
      answer: currentAnswer,
      settings,
    });

    const index = activeRun.sequence.indexOf(currentQuestion.id);
    const fallback = index >= 0 ? activeRun.sequence[index + 1] ?? null : null;

    // Ветвление может вернуть текущий вопрос (переход в его же раздел):
    // тогда идём по обычному порядку, чтобы читатель не застрял.
    const targetId = nextId && nextId !== currentQuestion.id ? nextId : fallback;

    if (!targetId) {
      setRun((previous) => (previous ? finishRun(previous) : previous));
      setConfirmFinish(false);
      scrollTop();
      return;
    }

    goTo(targetId);
  };

  /**
   * Фиксация ответа по кнопке «Готово» (карточка отправляет его сразу своими
   * кнопками). Выбор варианта до этого живёт в черновике, поэтому вердикт
   * появляется только здесь; в режиме ветвления оценки нет.
   */
  const answerQuestion = (value) => {
    if (!currentQuestion) return;

    setRun((previous) => {
      if (!previous || previous.finished) return previous;

      const questionId = currentQuestion.id;
      if (isResolved(previous.answers?.[questionId])) return previous;

      const picks = { ...previous.picks };
      delete picks[questionId];

      return {
        ...previous,
        answers: {
          ...previous.answers,
          [questionId]: { ...gradeAnswer(currentQuestion, value, graded), at: Date.now() },
        },
        picks,
      };
    });
  };

  const draftAnswer = (value) => {
    if (!currentQuestion) return;

    setRun((previous) => {
      if (!previous || previous.finished) return previous;
      if (isResolved(previous.answers?.[currentQuestion.id])) return previous;

      return {
        ...previous,
        picks: {
          ...previous.picks,
          [currentQuestion.id]: { ...(previous.picks?.[currentQuestion.id] ?? {}), ...value },
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

      <div className="test-run__layout">
        <div className="test-run__main">
          <ReaderQuestion
            question={currentQuestion}
            index={position}
            total={sequenceQuestions.length}
            answer={currentAnswer}
            draft={activeRun.picks?.[currentQuestion.id]}
            optionOrder={activeRun.optionOrder?.[currentQuestion.id]}
            pairOrder={activeRun.pairOrder?.[currentQuestion.id]}
            graded={graded}
            flagged={flaggedNow}
            onSubmit={answerQuestion}
            onDraft={draftAnswer}
            onToggleFlag={toggleCurrentFlag}
            onLinkClick={onInternalLink}
          />

          <div className="test-run__footer">
            <Button
              variant="ghost"
              onClick={() => previousId && goTo(previousId)}
              disabled={!previousId}
            >
              <Icon name="arrowLeft" size={16} />
              Назад
            </Button>

            <span className="test-run__footer-hint">{footerHint}</span>

            <Button onClick={goNext} disabled={!resolved}>
              Дальше
              <Icon name="arrowRight" size={16} />
            </Button>
          </div>
        </div>

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
      </div>
    </section>
  );
}
