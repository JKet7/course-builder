import { Router } from 'express';
import {
  createCourse,
  deleteCourse,
  getCourse,
  getCourseLinks,
  listCourses,
  reorderCourses,
  updateCourse,
} from '../controllers/courseController.js';
import { importCourse, uploadCourseArchive } from '../controllers/courseImportController.js';
import { exportCourse } from '../controllers/courseExportController.js';
import { getCoursePrint } from '../controllers/coursePrintController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditCourse = audit('Course');

const createRules = {
  title: { required: true, type: 'string', min: 1, max: 200, label: 'Название' },
  description: { type: 'string', max: 4000, label: 'Описание' },
};

const updateRules = {
  title: { type: 'string', min: 1, max: 200, label: 'Название' },
  description: { type: 'string', max: 4000, label: 'Описание' },
};

const reorderRules = {
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listCourses);
router.put('/reorder', editorOnly, validate(reorderRules), auditCourse, reorderCourses);
// Импорт архива (Шаг 13): multipart, поле `file`; тело — ZIP, не JSON.
router.post('/import', editorOnly, uploadCourseArchive, auditCourse, importCourse);
// Экспорт архива (Шаг 14): тот же формат, что читает импорт.
router.get('/:id/export', editorOnly, exportCourse);
// Печать курса (Шаг 15): полный курс одним JSON для страницы /course/:id/print.
router.get('/:id/print', getCoursePrint);
// Карта курса для внутренних ссылок (Правка 6): блоки и их элементы.
router.get('/:id/links', getCourseLinks);
router.get('/:id', getCourse);
router.post('/', editorOnly, validate(createRules), auditCourse, createCourse);
router.put('/:id', editorOnly, validate(updateRules), auditCourse, updateCourse);
router.delete('/:id', editorOnly, auditCourse, deleteCourse);

export default router;
