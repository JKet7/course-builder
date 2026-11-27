import { TiptapContent } from '../content/ContentRenderer.jsx';
import Icon from '../ui/Icon.jsx';
import { getQuestionType, getQuestionTypeLabel } from '../../utils/helpers.js';

/** Вопрос теста в режиме чтения: правильные ответы отмечены, пояснение под текстом. */
export default function QuestionView({ question, index, onLinkClick }) {
  const meta = getQuestionType(question.type);
  const data = question.data ?? {};
  const options = question.options ?? [];
  const pairs = question.pairs ?? [];

  return (
    <article className="question-view">
      <header className="question-view__head">
        <span className="question-view__index">{index + 1}</span>
        <span className="badge badge--gray">
          <Icon name={meta.icon} size={14} />
          {getQuestionTypeLabel(question.type)}
        </span>
        {question.group && <span className="question-view__group">{question.group.name}</span>}
      </header>

      {question.type === 'card' ? (
        <div className="question-view__flashcard">
          <div className="question-view__side">
            <span className="question-view__label">Вопрос</span>
            <p>{data.front || '—'}</p>
          </div>
          <div className="question-view__side question-view__side--answer">
            <span className="question-view__label">Ответ</span>
            <p>{data.back || '—'}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="question-view__text">{data.text}</p>

          {question.type === 'match' ? (
            <table className="content-table question-view__pairs">
              <tbody>
                {pairs.map((pair) => (
                  <tr key={pair.id}>
                    <td>{pair.left}</td>
                    <td>{pair.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="question-view__options">
              {options.map((option) => (
                <li
                  key={option.id}
                  className={option.isCorrect ? 'question-view__option is-correct' : 'question-view__option'}
                >
                  <span className="question-view__mark" aria-hidden="true">
                    {option.isCorrect ? '✓' : ''}
                  </span>
                  <span>{option.text}</span>
                  {option.isCorrect && <span className="visually-hidden">верный ответ</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {question.explanation && (
        <div className="question-view__explanation">
          <span className="question-view__label">Пояснение</span>
          <TiptapContent doc={question.explanation} onLinkClick={onLinkClick} />
        </div>
      )}
    </article>
  );
}
