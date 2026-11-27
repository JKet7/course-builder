import { Router } from 'express';
import {
  createTheme,
  deleteTheme,
  listThemes,
  setActiveTheme,
  updateTheme,
} from '../controllers/themeController.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const auditTheme = audit('Theme');

// Название проверяем декларативно; цвета (HEX и палитра) — в контроллере
const nameRule = { type: 'string', min: 1, max: 60, label: 'Название' };

router.use(requireAuth);

router.get('/', listThemes);
// Выбор темы — личная настройка пользователя: права проверяет контроллер, аудит не пишем
router.put('/active', setActiveTheme);
router.post('/', validate({ name: { ...nameRule, required: true } }), auditTheme, createTheme);
router.put('/:id', validate({ name: nameRule }), auditTheme, updateTheme);
router.delete('/:id', auditTheme, deleteTheme);

export default router;
