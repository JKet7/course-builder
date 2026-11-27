import { Router } from 'express';
import { createCell, deleteCell, listCells, reorderCells, updateCell } from '../controllers/memoController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditCell = audit('MemoCell');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  slideId: { type: 'string', label: 'Слайд' },
  title: { type: 'string', max: 200, label: 'Заголовок' },
};

const reorderRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  slideId: { type: 'string', label: 'Слайд' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listCells);
router.put('/reorder', editorOnly, validate(reorderRules), auditCell, reorderCells);
router.post('/', editorOnly, validate(createRules), auditCell, createCell);
router.put('/:id', editorOnly, auditCell, updateCell);
router.delete('/:id', editorOnly, auditCell, deleteCell);

export default router;
