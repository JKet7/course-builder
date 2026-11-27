import { Router } from 'express';
import {
  BLOCK_TYPES,
  createBlock,
  deleteBlock,
  getBlock,
  listBlocks,
  reorderBlocks,
  updateBlock,
} from '../controllers/blockController.js';
import {
  duplicateBlock,
  exportBlock,
  importBlock,
  uploadBlockFile,
} from '../controllers/blockTransferController.js';
import { getBlockHelp } from '../controllers/helpController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditBlock = audit('Block');

// Те же ограничения, что в CourseModal/BlockSettingsModal на клиенте
const createRules = {
  courseId: { required: true, type: 'string', label: 'Курс' },
  type: { required: true, type: 'string', in: BLOCK_TYPES, label: 'Тип' },
  title: { required: true, type: 'string', min: 1, max: 200, label: 'Название' },
  description: { type: 'string', max: 4000, label: 'Описание' },
  coverImage: { type: 'string', max: 500, label: 'Обложка' },
};

const updateRules = {
  type: { type: 'string', in: BLOCK_TYPES, label: 'Тип' },
  title: { type: 'string', min: 1, max: 200, label: 'Название' },
  description: { type: 'string', max: 4000, label: 'Описание' },
  coverImage: { type: 'string', max: 500, label: 'Обложка' },
};

const reorderRules = {
  courseId: { required: true, type: 'string', label: 'Курс' },
  orderedIds: { required: true, type: 'array', minLength: 1, label: 'Список id' },
};

router.use(requireAuth);

router.get('/', listBlocks);
router.put('/reorder', editorOnly, validate(reorderRules), auditBlock, reorderBlocks);
// Перенос одного блока: файл JSON/ZIP и обратный экспорт в JSON-манифест.
router.post('/import', editorOnly, uploadBlockFile, auditBlock, importBlock);
router.get('/:id/export', editorOnly, exportBlock);
router.post('/:id/duplicate', editorOnly, auditBlock, duplicateBlock);
// Справка о блоке (Правка 7): примечания и обратные ссылки — только чтение.
router.get('/:id/help', getBlockHelp);
router.get('/:id', getBlock);
router.post('/', editorOnly, validate(createRules), auditBlock, createBlock);
router.put('/:id', editorOnly, validate(updateRules), auditBlock, updateBlock);
router.delete('/:id', editorOnly, auditBlock, deleteBlock);

export default router;
