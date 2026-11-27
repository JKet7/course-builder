import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PRESET_THEMES } from '../src/utils/theme.js';

const prisma = new PrismaClient();

const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'admin123';

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { login: ADMIN_LOGIN },
    update: {},
    create: { login: ADMIN_LOGIN, passwordHash, role: 'admin' },
  });

  // Глобальные темы создаём по списку пресетов (Шаг 12): «Классическая» и «Тёмная»
  const themes = [];

  for (const preset of PRESET_THEMES) {
    let theme = await prisma.theme.findFirst({
      where: { isGlobal: true, ownerId: null, name: preset.name },
    });

    if (!theme) {
      theme = await prisma.theme.create({
        data: { name: preset.name, colors: preset.colors, isGlobal: true, ownerId: null },
      });
    }

    themes.push(theme);
  }

  const defaultTheme = themes[0];

  if (!admin.activeThemeId) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { activeThemeId: defaultTheme.id },
    });
  }

  console.log('[seed] ok:', {
    admin: admin.login,
    role: admin.role,
    themes: themes.map((theme) => theme.name).join(', '),
  });
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
