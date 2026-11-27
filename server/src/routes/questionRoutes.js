import { Router } from 'express';
import {
  createQuestion,
  deleteQuestion,
  duplicateQuestion,
  listQuestions,
  reorderQuestions,
  updateQuestion,
} from '../controllers/testQuestionController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';
import { QUESTION_TYPES } from '../utils/questions.js';

const router = Router();

const auditQuestion = audit('Question');

const createRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  type: { required: true, type: 'string', in: QUESTION_TYPES, label: 'Тип вопроса' },
};

const updateRules = {
  type: { type: 'string', in: QUESTION_TYPES, label: 'Тип вопроса' },
};

const reorderRules = {
  blockId: { required: true, type: 'string', label: 'Блок' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listQuestions);
router.put('/reorder', editorOnly, validate(reorderRules), auditQuestion, reorderQuestions);
router.post('/', editorOnly, validate(createRules), auditQuestion, createQuestion);
router.post('/:id/duplicate', editorOnly, auditQuestion, duplicateQuestion);
router.put('/:id', editorOnly, validate(updateRules), auditQuestion, updateQuestion);
router.delete('/:id', editorOnly, auditQuestion, deleteQuestion);

export default router;
