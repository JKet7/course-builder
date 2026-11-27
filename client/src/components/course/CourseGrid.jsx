import AddCourseCard from './AddCourseCard.jsx';
import CourseCard from './CourseCard.jsx';

/** Сетка курсов. */
export default function CourseGrid({ courses, onEdit, onDelete, onAdd, onExport, onPrint }) {
  return (
    <div className="course-grid">
      {courses.map((course) => (
        <CourseCard
          key={course.id}
          course={course}
          onEdit={onEdit ? () => onEdit(course) : undefined}
          onDelete={onDelete ? () => onDelete(course) : undefined}
          onExport={onExport ? () => onExport(course) : undefined}
          onPrint={onPrint ? () => onPrint(course) : undefined}
        />
      ))}

      {onAdd && <AddCourseCard onClick={onAdd} />}
    </div>
  );
}
