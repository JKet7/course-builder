import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/testSectionController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditSettings = audit('TestSettings');

const updateRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
};

router.use(requireAuth);

router.get('/', getSettings);
router.put('/', editorOnly, validate(updateRules), auditSettings, updateSettings);

export default router;
