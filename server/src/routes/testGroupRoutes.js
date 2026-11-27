import { Router } from 'express';
import {
  createGroup,
  deleteGroup,
  listGroups,
  reorderGroups,
  updateGroup,
} from '../controllers/testGroupController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditGroup = audit('Group');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  name: { type: 'string', max: 120, label: 'Название' },
};

const updateRules = {
  name: { required: true, type: 'string', min: 1, max: 120, label: 'Название' },
};

const reorderRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listGroups);
router.put('/reorder', editorOnly, validate(reorderRules), auditGroup, reorderGroups);
router.post('/', editorOnly, validate(createRules), auditGroup, createGroup);
router.put('/:id', editorOnly, validate(updateRules), auditGroup, updateGroup);
router.delete('/:id', editorOnly, auditGroup, deleteGroup);

export default router;
