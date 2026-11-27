import { Router } from 'express';
import { createSlide, deleteSlide, listSlides, reorderSlides, updateSlide } from '../controllers/memoController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditSlide = audit('MemoSlide');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  title: { type: 'string', max: 200, label: 'Заголовок' },
};

const reorderRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listSlides);
router.put('/reorder', editorOnly, validate(reorderRules), auditSlide, reorderSlides);
router.post('/', editorOnly, validate(createRules), auditSlide, createSlide);
router.put('/:id', editorOnly, auditSlide, updateSlide);
router.delete('/:id', editorOnly, auditSlide, deleteSlide);

export default router;
