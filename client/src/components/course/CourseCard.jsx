import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import Menu from '../ui/Menu.jsx';
import { formatDate, pluralize } from '../../utils/helpers.js';

/** Меню карточки курса. */
export function CourseMenu({ onEdit, onDelete, onExport, onPrint }) {
  return (
    <Menu
      label="Действия с курсом"
      items={[
        onEdit && { key: 'edit', label: 'Редактировать', icon: 'pencil', onClick: onEdit },
        onExport && { key: 'export', label: 'Экспорт ZIP', icon: 'download', onClick: onExport },
        onPrint && { key: 'print', label: 'Печать / PDF', icon: 'printer', onClick: onPrint },
        onDelete && { key: 'delete', label: 'Удалить', icon: 'trash', variant: 'danger', onClick: onDelete },
      ]}
    />
  );
}

/**
 * Карточка курса.
 * course: { id, title, description, blocksCount, updatedAt }
 */
export default function CourseCard({ course, onEdit, onDelete, onExport, onPrint }) {
  const blocksLabel = `${course.blocksCount} ${pluralize(course.blocksCount, ['блок', 'блока', 'блоков'])}`;

  return (
    <article className="course-card">
      <Link to={`/course/${course.id}`} className="course-card__link">
        <h2 className="course-card__title">{course.title}</h2>
        {course.description && <p className="course-card__description">{course.description}</p>}
      </Link>

      <footer className="course-card__footer">
        <span className="badge badge--gray">
          <Icon name="layers" size={14} />
          {blocksLabel}
        </span>
        <span className="course-card__date">{formatDate(course.updatedAt)}</span>
        <CourseMenu onEdit={onEdit} onDelete={onDelete} onExport={onExport} onPrint={onPrint} />
      </footer>
    </article>
  );
}
