import { Router } from 'express';
import {
  createContent,
  deleteContent,
  getContent,
  listContents,
  reorderContents,
  updateContent,
} from '../controllers/contentController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditContent = audit('Content');

// type и data проверяются в контроллере: у каждого типа своя структура data
const createRules = {
  slideId: { required: true, type: 'string', label: 'Слайд' },
  width: { type: 'number', label: 'Ширина' },
};

const reorderRules = {
  slideId: { required: true, type: 'string', label: 'Слайд' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listContents);
router.put('/reorder', editorOnly, validate(reorderRules), auditContent, reorderContents);
router.get('/:id', getContent);
router.post('/', editorOnly, validate(createRules), auditContent, createContent);
router.put('/:id', editorOnly, validate({ width: { type: 'number', label: 'Ширина' } }), auditContent, updateContent);
router.delete('/:id', editorOnly, auditContent, deleteContent);

export default router;
