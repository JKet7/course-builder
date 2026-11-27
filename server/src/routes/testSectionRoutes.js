import { Router } from 'express';
import {
  createSection,
  deleteSection,
  listSections,
  reorderSections,
  updateSection,
} from '../controllers/testSectionController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditSection = audit('Section');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  title: { type: 'string', max: 200, label: 'Название' },
};

const updateRules = {
  title: { type: 'string', max: 200, label: 'Название' },
};

const reorderRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listSections);
router.put('/reorder', editorOnly, validate(reorderRules), auditSection, reorderSections);
router.post('/', editorOnly, validate(createRules), auditSection, createSection);
router.put('/:id', editorOnly, validate(updateRules), auditSection, updateSection);
router.delete('/:id', editorOnly, auditSection, deleteSection);

export default router;
