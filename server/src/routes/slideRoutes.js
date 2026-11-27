import { Router } from 'express';
import {
  createSlide,
  deleteSlide,
  getSlide,
  listSlides,
  reorderSlides,
  updateSlide,
} from '../controllers/slideController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditSlide = audit('Slide');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  title: { type: 'string', max: 200, label: 'Название' },
};

const reorderRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listSlides);
router.put('/reorder', editorOnly, validate(reorderRules), auditSlide, reorderSlides);
router.get('/:id', getSlide);
router.post('/', editorOnly, validate(createRules), auditSlide, createSlide);
router.put('/:id', editorOnly, auditSlide, updateSlide);
router.delete('/:id', editorOnly, auditSlide, deleteSlide);

export default router;
