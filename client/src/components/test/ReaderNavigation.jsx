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
 * Клик по номеру сразу переключает вопрос.
 */
export default function ReaderNavigation({ questions, currentId, answers, graded = true, onSelect }) {
  return (
    <ol className="test-nav" aria-label="Вопросы теста">
      {questions.map((question, index) => {
        const answer = answers?.[question.id];
        const status = isResolved(answer) ? (graded ? answer.verdict : 'answered') : 'empty';
        const isCurrent = question.id === currentId;

        const classes = ['test-nav__btn', `is-${status}`, isCurrent ? 'is-current' : ''].filter(Boolean).join(' ');

        return (
          <li className="test-nav__item" key={question.id}>
            <button
              type="button"
              className={classes}
              data-question-id={question.id}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`Вопрос ${index + 1}: ${STATUS_LABELS[status] ?? 'без ответа'}`}
              title={question.group?.name ?? `Вопрос ${index + 1}`}
              onClick={() => onSelect(question.id)}
            >
              {index + 1}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
