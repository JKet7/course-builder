import { Router } from 'express';
import {
  createTerm,
  deleteTerm,
  importTerms,
  listTerms,
  updateTerm,
} from '../controllers/glossaryController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditTerm = audit('Term');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  term: { required: true, type: 'string', min: 1, max: 200, label: 'Термин' },
};

const importRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  terms: { required: true, type: 'array', minLength: 1, label: 'Список терминов' },
};

const updateRules = {
  term: { type: 'string', min: 1, max: 200, label: 'Термин' },
};

router.use(requireAuth);

router.get('/', listTerms);
router.post('/bulk', editorOnly, validate(importRules), auditTerm, importTerms);
router.post('/', editorOnly, validate(createRules), auditTerm, createTerm);
router.put('/:id', editorOnly, validate(updateRules), auditTerm, updateTerm);
router.delete('/:id', editorOnly, auditTerm, deleteTerm);

export default router;
