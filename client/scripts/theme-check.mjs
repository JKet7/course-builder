/**
 * Проверка тем оформления без браузера (Шаг 12): jsdom + те же утилиты и стор,
 * что использует приложение, плюс реальный рендер страницы тем.
 *
 * Запуск: node scripts/theme-check.mjs
 */
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const root = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

const paused = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

const vite = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

try {
  const themes = await vite.ssrLoadModule('/src/utils/themes.js');
  const { useThemeStore } = await vite.ssrLoadModule('/src/store/themeStore.js');
  const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');

  const html = document.documentElement;
  const cssVar = (name) => html.style.getPropertyValue(name);

  // ===== Утилиты цвета =====
  check('mixHex: середина между белым и чёрным', themes.mixHex('#FFFFFF', '#000000', 0.5) === '#808080', themes.mixHex('#FFFFFF', '#000000', 0.5));
  check('shadeHex: затемнение меняет цвет', themes.shadeHex('#8B2332', -0.12) !== '#8B2332', themes.shadeHex('#8B2332', -0.12));
  check(
    'mixHex: крайние значения',
    themes.mixHex('#123456', '#ABCDEF', 0) === '#123456' && themes.mixHex('#123456', '#ABCDEF', 1) === '#ABCDEF',
  );

  const darkAccent = themes.themeVariables({ accent: '#111827' });
  const lightAccent = themes.themeVariables({ accent: '#E0A458' });
  check('контраст: тёмный акцент → белый текст', darkAccent['--color-primary-text'] === '#FFFFFF', darkAccent['--color-primary-text']);
  check('контраст: светлый акцент → тёмный текст', lightAccent['--color-primary-text'] === '#1B1B16', lightAccent['--color-primary-text']);

  const incomplete = themes.themeVariables({ accent: '#2F6F6B' });
  check(
    'themeVariables: неполный объект берёт значения по умолчанию',
    incomplete['--color-primary'] === '#2F6F6B' && incomplete['--color-bg'] === themes.DEFAULT_THEME_COLORS.background,
  );
  check(
    'themeVariables: поверхность и фон различимы',
    incomplete['--color-surface'] !== incomplete['--color-surface-alt'],
  );

  // ===== Применение к документу =====
  themes.applyTheme({ ...themes.DEFAULT_THEME_COLORS, accent: '#2F6F6B' });
  check('applyTheme: акцент попал в CSS-переменную', cssVar('--color-primary') === '#2F6F6B', cssVar('--color-primary'));
  check('applyTheme: фон попал в CSS-переменную', cssVar('--color-bg') === themes.DEFAULT_THEME_COLORS.background);
  check('applyTheme: переменных девять', html.style.length === 9, String(html.style.length));

  themes.resetTheme();
  check('resetTheme: переменные удалены', cssVar('--color-primary') === '' && html.style.length === 0, String(html.style.length));

  // ===== Стор =====
  themes.applyTheme(themes.DEFAULT_THEME_COLORS);
  useThemeStore.setState({
    themes: [{ id: 't-1', name: 'Классическая', colors: themes.DEFAULT_THEME_COLORS, isGlobal: true, isActive: true }],
    activeThemeId: 't-1',
  });
  check(
    'стор: activeTheme возвращает применённую тему',
    useThemeStore.getState().activeTheme()?.id === 't-1',
  );

  useThemeStore.getState().reset();
  check(
    'стор: reset очищает темы',
    useThemeStore.getState().themes.length === 0 && useThemeStore.getState().activeThemeId === null,
  );
  check('стор: reset возвращает оформление по умолчанию', cssVar('--color-primary') === '', cssVar('--color-primary'));

  // ===== Рендер страницы тем в DOM =====
  const { createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: ThemeEditorPage } = await vite.ssrLoadModule('/src/pages/ThemeEditorPage.jsx');

  useAuthStore.setState({
    isAuthenticated: true,
    isEditor: true,
    user: { id: 'u1', login: 'admin', role: 'admin', activeThemeId: 't-1' },
  });
  useThemeStore.setState({
    themes: [
      {
        id: 't-1',
        name: 'Классическая',
        colors: themes.DEFAULT_THEME_COLORS,
        isGlobal: true,
        ownerId: null,
        isOwn: false,
        isActive: true,
        canEdit: true,
        canDelete: false,
      },
      {
        id: 't-2',
        name: 'Моя тема',
        colors: { ...themes.DEFAULT_THEME_COLORS, accent: '#2F6F6B' },
        isGlobal: false,
        ownerId: 'u1',
        isOwn: true,
        isActive: false,
        canEdit: true,
        canDelete: true,
      },
    ],
    activeThemeId: 't-1',
    defaultThemeId: 't-1',
    loading: false,
    loaded: true,
    error: null,
    saving: false,
  });

  const host = document.getElementById('host');
  const reactRoot = createRoot(host);
  reactRoot.render(
    createElement(MemoryRouter, { initialEntries: ['/themes'] }, createElement(ThemeEditorPage)),
  );
  await paused(150);

  check('render: две карточки тем', host.querySelectorAll('.theme-card').length === 2, host.querySelectorAll('.theme-card').length);
  check('render: активная тема одна', host.querySelectorAll('.theme-card.is-active').length === 1);
  check(
    'render: 20 цветных точек палитры',
    host.querySelectorAll('.theme-card__dot').length === 20,
    host.querySelectorAll('.theme-card__dot').length,
  );
  check('render: удаление только у личной темы', host.querySelectorAll('.theme-card__delete').length === 1);
  check('render: кнопка «Применить» у неактивной темы', host.textContent.includes('Применить'));

  const newButton = [...host.querySelectorAll('button')].find((button) => button.textContent.includes('Новая тема'));
  newButton?.click();
  await paused(120);

  check('render: кнопка открывает форму', Boolean(host.querySelector('.theme-editor')));
  check(
    'render: в форме 16 color-picker (6 ролей + 10 палитры)',
    host.querySelectorAll('input[type="color"]').length === 16,
    host.querySelectorAll('input[type="color"]').length,
  );
  check('render: предпросмотр в форме', Boolean(host.querySelector('.theme-preview')));

  // Невалидный HEX: форма не уходит на сервер, показывается ошибка
  const accentInput = host.querySelector('#theme-color-accent');

  if (accentInput) {
    const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    valueSetter.call(accentInput, '#zzz');
    accentInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    host
      .querySelector('.theme-editor')
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await paused(80);
  }

  check('render: битый HEX подсвечен ошибкой', Boolean(host.querySelector('.field__error')));
  check('render: форма осталась открытой', Boolean(host.querySelector('.theme-editor')));

  reactRoot.unmount();
} finally {
  await vite.close();
}

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

await writeFile(
  fileURLToPath(new URL('../theme-check.json', import.meta.url)),
  JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2),
  'utf8',
);

process.exitCode = failed.length ? 1 : 0;
