import Icon from '../ui/Icon.jsx';

/** Плитка «Добавить курс» (показывается только редакторам). */
export default function AddCourseCard({ onClick }) {
  return (
    <button type="button" className="course-card course-card--add" onClick={onClick}>
      <Icon name="plus" size={28} />
      <span>Добавить курс</span>
    </button>
  );
}
