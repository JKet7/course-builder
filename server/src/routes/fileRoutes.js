import { Router } from 'express';
import { createFile, deleteFile, uploadOneFile } from '../controllers/fileController.js';
import { editorOnly, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

const auditFile = audit('File');

router.use(requireAuth);

// Картинки (до 5 МБ) и видео (до 200 МБ) для фрагментов: только admin/editor
router.post('/', editorOnly, auditFile, uploadOneFile, createFile);
router.delete('/:id', editorOnly, auditFile, deleteFile);


export default router;
