import { isResolved } from '../../utils/testRun.js';

const STATUS_LABELS = {
  correct: 'верно',
  wrong: 'неверно',
  answered: 'отвечен',
  empty: 'без ответа',
};

/**
 * Сетка навигации читателя: номер вопроса и его статус.
 * Синий контур — текущий, зелёный — верно, красный — неверно, серый — без
 * ответа. В режиме ветвления оценки нет: вопрос либо отвечен, либо нет.
 * Помеченный флажком «Вернуться позже» вопрос получает красный треугольник в
 * правом верхнем углу ячейки — как индикатор флажка в Moodle. Клик по номеру
 * сразу переключает вопрос, в том числе помеченный.
 */
export default function ReaderNavigation({ questions, currentId, answers, flags, graded = true, onSelect }) {
  return (
    <ol className="test-nav" aria-label="Вопросы теста">
      {questions.map((question, index) => {
        const answer = answers?.[question.id];
        const status = isResolved(answer) ? (graded ? answer.verdict : 'answered') : 'empty';
        const isCurrent = question.id === currentId;
        const flagged = Boolean(flags?.[question.id]);

        const classes = ['test-nav__btn', `is-${status}`, isCurrent ? 'is-current' : '', flagged ? 'is-flagged' : '']
          .filter(Boolean)
          .join(' ');

        const statusLabel = STATUS_LABELS[status] ?? 'без ответа';
        const label = `Вопрос ${index + 1}: ${statusLabel}${flagged ? ', отмечен для возврата' : ''}`;
        const title = [question.group?.name ?? `Вопрос ${index + 1}`, flagged ? 'Отмечен для возврата' : '']
          .filter(Boolean)
          .join(' · ');

        return (
          <li className="test-nav__item" key={question.id}>
            <button
              type="button"
              className={classes}
              data-question-id={question.id}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={label}
              title={title}
              onClick={() => onSelect(question.id)}
            >
              {index + 1}
              {flagged && <span className="test-nav__flag" aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
