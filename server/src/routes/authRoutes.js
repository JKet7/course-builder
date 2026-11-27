import { Router } from 'express';
import { guestLogin, login, me } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const loginRules = {
  login: { required: true, type: 'string', min: 2, max: 64, label: 'Логин' },
  password: { required: true, type: 'string', min: 1, max: 128, trim: false, label: 'Пароль' },
};

router.post('/login', validate(loginRules), login);
// Вход без логина и пароля: сервер выдаёт сессию роли reader (только чтение)
router.post('/guest', guestLogin);
router.get('/me', requireAuth, me);

export default router;
