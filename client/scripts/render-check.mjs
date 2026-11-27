/**
 * Проверка рендера клиента без браузера: поднимает Vite в middleware-режиме,
 * грузит модули через SSR и рендерит страницы в строку. Ловит падения JSX,
 * неверные пропсы и импорты (сборка такие ошибки иногда пропускает).
 *
 * Запуск: node scripts/render-check.mjs
 */
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';

// Сторы читают localStorage на этапе импорта — подставляем заглушку до загрузки модулей.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

const root = fileURLToPath(new URL('..', import.meta.url));
const results = [];

const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
};

const vite = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

try {
  const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
  const { default: CourseGrid } = await vite.ssrLoadModule('/src/components/course/CourseGrid.jsx');
  const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
  const { useCourseStore } = await vite.ssrLoadModule('/src/store/courseStore.js');
  const {
    checklistStorageKey,
    hasChecklistProgress,
    readChecklistProgress,
    resetChecklistProgress,
    setChecklistItemChecked,
  } = await vite.ssrLoadModule('/src/utils/checklistProgress.js');

  // В SSR zustand отдаёт snapshot из getInitialState(), поэтому «сидируем»
  // исходное состояние объекта (setState создаёт новый — его SSR не увидит).
  const seed = (store, patch) => {
    Object.assign(store.getInitialState(), patch);
  };

  const render = (Component, location = '/', props = {}) =>
    renderToStaticMarkup(
      React.createElement(StaticRouter, { location }, React.createElement(Component, props)),
    );

  const sampleCourses = [
    {
      id: 'course-1',
      title: 'Охрана труда',
      description: 'Базовый курс для новых сотрудников: теория, тесты и памятки.',
      blocksCount: 3,
      updatedAt: '2026-11-10T12:00:00.000Z',
    },
    {
      id: 'course-2',
      title: 'Пожарная безопасность',
      description: '',
      blocksCount: 1,
      updatedAt: '2026-11-11T09:30:00.000Z',
    },
  ];

  // 1. Страница входа
  const loginHtml = render(App, '/login');
  check('login: форма отрисована', loginHtml.includes('auth-card'));
  check('login: два поля', (loginHtml.match(/class="input"/g) ?? []).length === 2);
  check('login: кнопки редактора и читателя', loginHtml.includes('>Войти<') && loginHtml.includes('Войти, как читатель'));
  check('login: нет демо-логина и пароля', !loginHtml.includes('admin') && !loginHtml.includes('Демо-доступ'));
  check('login: боковая панель', loginHtml.includes('auth-hero'));

  // 2. Дашборд редактора со списком курсов
  seed(useAuthStore, { isEditor: true, isAuthenticated: true });
  seed(useCourseStore, { courses: sampleCourses, loading: false, loaded: true, error: null });
  const editorHtml = render(App, '/');

  check('dashboard: заголовок', editorHtml.includes('>Курсы<'));
  check('dashboard: счётчик курсов', editorHtml.includes('page__counter">2<'));
  check('dashboard: карточки отрисованы', (editorHtml.match(/class="course-card"/g) ?? []).length === 2);
  check('dashboard: плитка добавления', editorHtml.includes('course-card--add'));
  check('dashboard: меню карточки', editorHtml.includes('Редактировать') && editorHtml.includes('Удалить'));
  check('dashboard: счётчик блоков', editorHtml.includes('3 блока') && editorHtml.includes('1 блок'));
  check('dashboard: дата отформатирована', editorHtml.includes('10.11.2026'));

  // 3. Дашборд читателя: без плитки добавления и без меню
  seed(useAuthStore, { isEditor: false, isAuthenticated: true });
  const readerHtml = render(App, '/');
  check('reader: нет плитки добавления', !readerHtml.includes('course-card--add'));
  check('reader: нет меню действий', !readerHtml.includes('menu__trigger'));
  check('reader: карточки на месте', readerHtml.includes('Охрана труда'));

  // 4. Пустой дашборд читателя
  seed(useCourseStore, { courses: [], loaded: true, loading: false });
  const emptyHtml = render(App, '/');
  check('empty: пустое состояние', emptyHtml.includes('Курсов пока нет'));

  // 5. Ошибка загрузки
  seed(useCourseStore, { courses: [], loaded: true, loading: false, error: 'Сервер недоступен' });
  const errorHtml = render(App, '/');
  check('error: алерт и кнопка повтора', errorHtml.includes('alert--error') && errorHtml.includes('Повторить'));

  // 5b. Скелетоны при первой загрузке
  seed(useCourseStore, { courses: [], loaded: false, loading: true, error: null });
  const loadingHtml = render(App, '/');
  check('loading: скелетоны карточек', (loadingHtml.match(/class="course-card skeleton-card"/g) ?? []).length === 4);

  // 6. CourseGrid напрямую (без стора) — проверка пропсов/ссылок
  const gridHtml = render(CourseGrid, '/', {
    courses: sampleCourses,
    onAdd: () => {},
    onEdit: () => {},
    onDelete: () => {},
  });
  check('grid: ссылки на курсы', gridHtml.includes('href="/course/course-1"'));
  check('grid: плитка добавления', gridHtml.includes('Добавить курс'));

  // 7. Модалки: создание, редактирование, удаление курса
  const { useUiStore } = await vite.ssrLoadModule('/src/store/uiStore.js');
  seed(useUiStore, { modal: { name: 'course-create', payload: null } });
  const createHtml = render(App, '/');
  check('modal: окно создания курса', createHtml.includes('modal-overlay') && createHtml.includes('Новый курс'));
  check('modal: поля формы', createHtml.includes('Название') && createHtml.includes('Описание'));
  check('modal: кнопка создания', createHtml.includes('Создать курс'));

  seed(useUiStore, { modal: { name: 'course-edit', payload: sampleCourses[0] } });
  const editHtml = render(App, '/');
  check(
    'modal: редактирование с данными',
    editHtml.includes('Редактировать курс') && editHtml.includes('Охрана труда'),
  );
  check('modal: описание подставлено', editHtml.includes('Базовый курс для новых сотрудников'));

  seed(useUiStore, { modal: { name: 'course-delete', payload: sampleCourses[0] } });
  const deleteHtml = render(App, '/');
  check(
    'modal: подтверждение удаления',
    deleteHtml.includes('Удалить курс?') && deleteHtml.includes('без возможности восстановления'),
  );
  check('modal: предупреждение о блоках', deleteHtml.includes('3 блока'));

  seed(useUiStore, { modal: null });

  // 8. Страница курса: блоки, счётчики, действия редактора
  const { useBlockStore } = await vite.ssrLoadModule('/src/store/blockStore.js');

  const sampleCourse = {
    id: 'course-1',
    title: 'Охрана труда',
    description: 'Базовый курс для новых сотрудников.',
    blocksCount: 3,
    updatedAt: '2026-11-10T12:00:00.000Z',
  };

  const sampleBlocks = [
    {
      id: 'block-1',
      courseId: 'course-1',
      type: 'theory',
      title: 'Введение',
      description: 'Основные понятия и нормативная база',
      coverImage: null,
      contentCount: 3,
      order: 0,
      updatedAt: '2026-11-09T10:00:00.000Z',
    },
    {
      id: 'block-2',
      courseId: 'course-1',
      type: 'test',
      title: 'Итоговый тест',
      description: '',
      coverImage: null,
      contentCount: 5,
      order: 1,
      updatedAt: '2026-11-10T09:00:00.000Z',
    },
    {
      id: 'block-3',
      courseId: 'course-1',
      type: 'glossary',
      title: 'Термины',
      description: 'Словарь курса',
      coverImage: '/uploads/cover.png',
      contentCount: 12,
      order: 2,
      updatedAt: '2026-11-11T08:00:00.000Z',
    },
  ];

  seed(useCourseStore, { currentCourse: sampleCourse, courseLoading: false, courseError: null, courseNotFound: false });
  seed(useBlockStore, { courseId: 'course-1', blocks: sampleBlocks, loading: false, loaded: true, error: null });
  seed(useAuthStore, { isEditor: true, isAuthenticated: true });

  const courseHtml = render(App, '/course/course-1');

  // Превью с обложкой рендерим напрямую: в списке первый блок без картинки
  const { default: BlockPreview } = await vite.ssrLoadModule('/src/components/block/BlockPreview.jsx');
  const previewHtml = renderToStaticMarkup(React.createElement(BlockPreview, { block: sampleBlocks[2] }));
  check(
    'preview: обложка, бейдж и описание блока',
    previewHtml.includes('src="/uploads/cover.png"') &&
      previewHtml.includes('Глоссарий') &&
      previewHtml.includes('Словарь курса'),
  );
  check('course: заголовок курса', courseHtml.includes('Охрана труда'));
  check('course: хлебные крошки', courseHtml.includes('breadcrumbs') && courseHtml.includes('href="/"'));
  check('course: описание курса', courseHtml.includes('Базовый курс для новых сотрудников.'));
  check('course: три карточки блоков', (courseHtml.match(/class="block-item[ "]/g) ?? []).length === 3);
  check('course: бейджи типов', ['Теория', 'Тест', 'Глоссарий'].every((label) => courseHtml.includes(label)));
  check(
    'course: счётчики содержимого',
    courseHtml.includes('3 слайда') && courseHtml.includes('5 вопросов') && courseHtml.includes('12 терминов'),
  );
  check('course: ссылки на блоки', courseHtml.includes('href="/block/block-1"') && courseHtml.includes('href="/block/block-3"'));
  check('course: карточка-кнопка «Добавить блок»', courseHtml.includes('course-blocks__add'));
  check('course: поиск блока в левой панели', courseHtml.includes('course-search') && courseHtml.includes('Поиск блока...'));
  check('course: превью блока без обложки', courseHtml.includes('block-preview__stub'));
  check(
    'course: превью выбранного блока',
    courseHtml.includes('block-preview__overlay') && courseHtml.includes('block-preview__title'),
  );
  check(
    'course: кнопка действия «Начать» у каждого блока',
    (courseHtml.match(/class="block-item__action"/g) ?? []).length === 3 && courseHtml.includes('>Начать'),
  );
  check(
    'course: меню настроек курса из пяти пунктов',
    ['Добавить блок', 'Загрузить блок', 'Редактировать курс', 'Скачать курс', 'Создать тему'].every((label) =>
      courseHtml.includes(label),
    ),
  );
  check(
    'course: меню блока ⋮ у редактора',
    (courseHtml.match(/aria-label="Действия с блоком"/g) ?? []).length === 3,
  );
  check('course: счётчик блоков', courseHtml.includes('page__counter">3<'));
  check(
    'course: кнопка «Печать / PDF» ведёт на страницу печати',
    courseHtml.includes('Печать / PDF') && courseHtml.includes('href="/course/course-1/print"'),
  );

  // 8a. Блоки для читателя: без плитки добавления и меню действий
  seed(useAuthStore, { isEditor: false, isAuthenticated: true });
  const readerCourseHtml = render(App, '/course/course-1');
  check('course (reader): нет карточки добавления', !readerCourseHtml.includes('course-blocks__add'));
  check('course (reader): нет меню действий', !readerCourseHtml.includes('Действия с блоком'));
  check('course (reader): нет меню настроек курса', !readerCourseHtml.includes('Создать тему'));
  check('course (reader): кнопки «Начать» на месте', readerCourseHtml.includes('block-item__action'));
  check('course (reader): печать доступна', readerCourseHtml.includes('Печать / PDF'));

  // Правка 10: сохранённые отметки чек-листа меняют действие блока
  // и добавляют кнопку «Сначала» для сброса прогресса.
  setChecklistItemChecked('block-1', 'content-3', '1', true);
  const progressCourseHtml = render(App, '/course/course-1');
  check(
    'course: при прогрессе — «Продолжить» и «Сначала»',
    progressCourseHtml.includes('>Продолжить') &&
      (progressCourseHtml.match(/block-item__reset/g) ?? []).length === 1 &&
      progressCourseHtml.includes('Сбросить все отметки в чек-листах блока'),
  );

  resetChecklistProgress('block-1');
  const resetCourseHtml = render(App, '/course/course-1');
  check(
    'course: «Сначала» сбрасывает прогресс блока',
    !resetCourseHtml.includes('block-item__reset') &&
      !resetCourseHtml.includes('>Продолжить') &&
      resetCourseHtml.includes('>Начать') &&
      !hasChecklistProgress('block-1'),
  );

  setChecklistItemChecked('block-progress', 'content-1', '1', true);
  const stored = readChecklistProgress('block-progress');
  setChecklistItemChecked('block-progress', 'content-1', '1', false);
  check(
    'checklist (storage): отметка сохраняется и снимается',
    stored['content-1:1'] === true &&
      hasChecklistProgress('block-progress') === false &&
      Object.keys(readChecklistProgress('block-progress')).length === 0,
  );
  check(
    'checklist (storage): ключ блока привязан к blockId',
    checklistStorageKey('block-progress') === 'course-builder:checklist:block-progress',
  );
  resetChecklistProgress('block-progress');

  seed(useAuthStore, { isEditor: true, isAuthenticated: true });

  // 8b. Курс не найден
  seed(useCourseStore, { currentCourse: null, courseNotFound: true });
  seed(useBlockStore, { courseId: 'course-1', blocks: [], loading: false, loaded: true, error: null });
  const missingCourseHtml = render(App, '/course/unknown');
  check('course: пустое состояние «не найден»', missingCourseHtml.includes('Курс не найден'));
  check('course: ссылка назад к курсам', missingCourseHtml.includes('К списку курсов'));

  // 8c. Ошибка загрузки блоков с кнопкой повтора
  seed(useCourseStore, { currentCourse: sampleCourse, courseNotFound: false });
  seed(useBlockStore, {
    courseId: 'course-1',
    blocks: [],
    loading: false,
    loaded: true,
    error: 'Сервер недоступен',
  });
  const blocksErrorHtml = render(App, '/course/course-1');
  check(
    'course: алерт ошибки блоков',
    blocksErrorHtml.includes('alert--error') && blocksErrorHtml.includes('Сервер недоступен'),
  );

  // 8d. Модалки блока
  seed(useBlockStore, { courseId: 'course-1', blocks: sampleBlocks, loading: false, loaded: true, error: null });

  seed(useUiStore, { modal: { name: 'block-create', payload: { courseId: 'course-1' } } });
  const blockCreateHtml = render(App, '/course/course-1');
  check('modal: окно создания блока', blockCreateHtml.includes('Новый блок'));
  check(
    'modal: четыре типа блока',
    ['Теория', 'Тест', 'Памятка', 'Глоссарий'].every((label) => blockCreateHtml.includes(label)),
  );
  check('modal: кнопка создания блока', blockCreateHtml.includes('Создать блок'));

  seed(useUiStore, { modal: { name: 'block-edit', payload: sampleBlocks[2] } });
  const blockEditHtml = render(App, '/course/course-1');
  check(
    'modal: настройки блока с данными',
    blockEditHtml.includes('Настройки блока') && blockEditHtml.includes('Термины'),
  );
  check('modal: тип заблокирован при контенте', blockEditHtml.includes('Тип нельзя изменить'));

  seed(useUiStore, { modal: { name: 'block-delete', payload: sampleBlocks[1] } });
  const blockDeleteHtml = render(App, '/course/course-1');
  check(
    'modal: удаление блока',
    blockDeleteHtml.includes('Удалить блок?') && blockDeleteHtml.includes('Итоговый тест'),
  );

  seed(useUiStore, { modal: null });

  // 9. Страница блока «Теория» (Шаг 9)
  const { useContentStore } = await vite.ssrLoadModule('/src/store/contentStore.js');
  const { default: TheoryBlock } = await vite.ssrLoadModule('/src/components/editor/TheoryBlock.jsx');
  const { default: BlockPlaceholder } = await vite.ssrLoadModule('/src/components/block/BlockPlaceholder.jsx');

  const docWith = (text) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  const sampleContents = [
    { id: 'content-1', slideId: 'slide-1', type: 'text', data: docWith('Текст теории'), dataVersion: 1, width: 100, order: 0 },
    {
      id: 'content-2',
      slideId: 'slide-1',
      type: 'important',
      // Оформление блока: цвет фона и рамки, толщина и скругление (utils/important.js).
      // borderColor не задан — рамка считается на 18 % темнее фона.
      data: {
        ...docWith('Важное правило'),
        important: { background: '#FEF3C7', borderColor: '', borderWidth: 2, radius: 8 },
      },
      dataVersion: 1,
      width: 50,
      order: 1,
    },
    {
      id: 'content-3',
      slideId: 'slide-1',
      type: 'checklist',
      data: { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: 'Пункт', checked: false }] },
      dataVersion: 1,
      width: 50,
      order: 2,
    },
  ];

  const sampleSlides = [
    { id: 'slide-1', blockId: 'block-1', title: 'Введение', order: 0, contents: sampleContents, contentCount: 3 },
    { id: 'slide-2', blockId: 'block-1', title: 'Основы', order: 1, contents: [], contentCount: 0 },
  ];

  const theoryBlock = {
    id: 'block-1',
    courseId: 'course-1',
    course: { id: 'course-1', title: 'Охрана труда' },
    type: 'theory',
    title: 'Введение',
    description: 'Основные понятия и нормативная база',
    contentCount: 3,
  };

  seed(useBlockStore, { currentBlock: theoryBlock, blockLoading: false, blockError: null, blockNotFound: false });
  seed(useContentStore, {
    blockId: 'block-1',
    slides: sampleSlides,
    activeSlideId: 'slide-1',
    loading: false,
    loaded: true,
    error: null,
  });
  seed(useAuthStore, { isEditor: true, isAuthenticated: true });
  seed(useUiStore, { uiMode: 'edit', modal: null });

  const blockHtml = render(App, '/block/block-1');
  check('block: заголовок и хлебные крошки', blockHtml.includes('Введение') && blockHtml.includes('/course/course-1'));
  check('block: бейдж типа и счётчик', blockHtml.includes('Теория') && blockHtml.includes('3 слайда'));
  check('block: кнопки редактора', blockHtml.includes('К курсу') && blockHtml.includes('Настройки') && blockHtml.includes('Удалить'));

  const theoryHtml = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check('theory: панель инструментов', theoryHtml.includes('toolbar') && theoryHtml.includes('Добавить контент'));
  check('theory: кнопки форматирования', theoryHtml.includes('Жирный') && theoryHtml.includes('Курсив') && theoryHtml.includes('Ссылка'));
  check(
    'theory: группа списков',
    theoryHtml.includes('Многоуровневый список') &&
      theoryHtml.includes('Понизить уровень') &&
      theoryHtml.includes('Повысить уровень'),
  );
  check('theory: содержание с слайдами', theoryHtml.includes('Содержание') && theoryHtml.includes('Основы'));
  check('theory: навигация по слайдам', theoryHtml.includes('slide-nav') && theoryHtml.includes('1 / 2'));
  check('theory: поле названия слайда', theoryHtml.includes('Название слайда'));
  check('theory: карточки контента', (theoryHtml.match(/content-card__head/g) ?? []).length === 3);
  check('theory: подписи типов в правке', (theoryHtml.match(/content-card__type/g) ?? []).length === 3);
  check('theory: «плюсики» добавления', theoryHtml.includes('content-plus'));

  // «Плюсик» последнего ряда вставлял фрагмент туда же, куда нижний (в конец),
  // и в памятке/глоссарии они стояли друг под другом. Теперь «плюсик» есть
  // только у ряда, за которым идёт продолжение: 100 + (50 + 50) — один рядный.
  check(
    'grid: последний ряд без «плюсика» (нет дубля с нижним)',
    (theoryHtml.match(/Добавить фрагмент в этот ряд/g) ?? []).length === 1 &&
      (theoryHtml.match(/Добавить фрагмент в новый ряд/g) ?? []).length === 1 &&
      (theoryHtml.match(/slide-row slide-row--edit/g) ?? []).length === 2 &&
      (theoryHtml.match(/slide-row--add/g) ?? []).length === 1,
  );

  // Меню «плюсика» держим в состоянии React: у нативного <details> открытое
  // состояние оставалось в DOM, и после выбора типа меню «залипало».
  const gridSource = await readFile(new URL('../src/components/content/ContentGrid.jsx', import.meta.url), 'utf8');
  check(
    'grid: меню «плюсика» закрывается после выбора типа',
    !gridSource.includes('</details>') &&
      !gridSource.includes('<summary') &&
      gridSource.includes('aria-expanded={open}') &&
      /onSelect=\{\(type\) => \{[\s\S]{0,400}?setOpen\(false\);[\s\S]{0,120}?onPick\(type\);/.test(gridSource) &&
      gridSource.includes("event.key === 'Escape'") &&
      theoryHtml.includes('aria-expanded="false"'),
  );

  // Правка 3: одна панель инструментов на блок работает с полем в фокусе
  const { useEditorStore } = await vite.ssrLoadModule('/src/store/editorStore.js');
  const fakeEditor = { isDestroyed: false };

  useEditorStore.getState().setActiveEditor(fakeEditor);
  const editorRegistered = useEditorStore.getState().activeEditor === fakeEditor;

  useEditorStore.getState().releaseEditor(fakeEditor);
  check(
    'toolbar: активное поле запоминается и освобождается',
    editorRegistered && useEditorStore.getState().activeEditor === null,
  );
  // 9a. Шаг 17: поиск по документу
  const { default: DocumentSearch } = await vite.ssrLoadModule('/src/components/editor/DocumentSearch.jsx');

  check(
    'theory: кнопка поиска по документу',
    theoryHtml.includes('Поиск по документу') && theoryHtml.includes('Ctrl + F'),
  );

  const searchPanel = render(DocumentSearch, '/block/block-1', {
    slides: sampleSlides,
    activeSlideId: 'slide-1',
    initialQuery: 'правило',
    onSelect: () => {},
    onClose: () => {},
  });
  check(
    'search: результат с подсветкой',
    searchPanel.includes('doc-search__item') && searchPanel.includes('doc-search__match'),
  );
  check('search: слайд и тип фрагмента', searchPanel.includes('Слайд 1') && searchPanel.includes('Важное'));

  const emptySearch = render(DocumentSearch, '/block/block-1', {
    slides: sampleSlides,
    initialQuery: 'вертолёт',
    onSelect: () => {},
    onClose: () => {},
  });
  check('search: пустая выдача', emptySearch.includes('Ничего не найдено') && !emptySearch.includes('doc-search__item'));



  // 9a. Режим просмотра: без тулбара и действий над контентом
  seed(useUiStore, { uiMode: 'view' });
  const readerTheory = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check('theory (view): тулбар скрыт', !readerTheory.includes('Добавить контент'));
  check('theory (view): текст и «важное»', readerTheory.includes('Текст теории') && readerTheory.includes('Важное правило'));
  check('theory (view): чек-лист отрисован', readerTheory.includes('content-checklist') && readerTheory.includes('Пункт'));
  check('theory (view): нет удаления контента', !readerTheory.includes('Удалить фрагмент'));
  check(
    'theory (view): карточки без шапок и типов',
    !readerTheory.includes('content-card__head') && !readerTheory.includes('content-card__type'),
  );
  check(
    'theory (view): бесшовные карточки',
    (readerTheory.match(/content-card--view/g) ?? []).length === 3,
  );
  // «Важное» — цветной блок с рамкой, как alert, но без иконки-маркера и
  // кнопки закрытия: внутри только текст. Цвет фона выбирает автор
  // (data.important), рамка по умолчанию на 18 % темнее фона.
  const importantStart = readerTheory.indexOf('class="content-important"');
  const importantSlice = readerTheory.slice(importantStart, importantStart + 500);
  check(
    'theory (view): «Важное» — блок с рамкой и скруглением',
    importantStart > -1 &&
      importantSlice.includes('background-color:#FEF3C7') &&
      importantSlice.includes('border-color:#D0C7A3') &&
      importantSlice.includes('border-width:2px') &&
      importantSlice.includes('border-radius:8px') &&
      importantSlice.includes('color:#1F2937'),
    importantSlice,
  );
  check(
    'theory (view): «Важное» без подписи, иконки и крестика',
    !readerTheory.includes('content-important__label') &&
      importantSlice.includes('Важное правило') &&
      !/<svg|<button|Закрыть/.test(importantSlice),
    importantSlice,
  );

  const {
    IMPORTANT_PALETTE,
    importantBlockStyle,
    importantBorderColor,
    normalizeImportantStyle,
    withImportantStyle,
  } = await vite.ssrLoadModule('/src/utils/important.js');

  check(
    'important: цвета, толщина и скругление нормализуются',
    normalizeImportantStyle({ background: '#fef3c7', borderWidth: 9, radius: 40 }).background === '#FEF3C7' &&
      normalizeImportantStyle({ borderWidth: 9, radius: 40 }).borderWidth === 2 &&
      normalizeImportantStyle({ borderWidth: 9, radius: 40 }).radius === 12 &&
      normalizeImportantStyle(null).borderWidth === 1 &&
      normalizeImportantStyle({ background: 'red' }).background === '' &&
      IMPORTANT_PALETTE.some((item) => item.value === ''),
  );
  check(
    'important: рамка на 18 % темнее фона',
    importantBorderColor({ background: '#FFFFFF' }) === '#D1D1D1' &&
      importantBorderColor({ background: '#FEF3C7' }) === '#D0C7A3' &&
      importantBorderColor({ background: '#FEF3C7', borderColor: '#123456' }) === '#123456',
  );
  check(
    'important: цвет текста подстраивается под фон',
    importantBlockStyle({ important: { background: '#DBEAFE' } }).color === '#1F2937' &&
      importantBlockStyle({ important: { background: '#4A1D3A' } }).color === '#F3F4F6' &&
      importantBlockStyle({}).backgroundColor === undefined &&
      importantBlockStyle({}).borderColor === undefined &&
      importantBlockStyle({}).borderWidth === '1px' &&
      importantBlockStyle({}).borderRadius === '10px',
  );

  const styledDoc = withImportantStyle(docWith('Текст'), { important: { background: '#DBEAFE', radius: 12 } });
  check(
    'important: оформление переживает сохранение текста',
    styledDoc.type === 'doc' &&
      styledDoc.content[0].content[0].text === 'Текст' &&
      styledDoc.important.background === '#DBEAFE' &&
      styledDoc.important.radius === 12 &&
      withImportantStyle(null, { important: { borderWidth: 2 } }).content.length === 1,
  );

  // Сервер нормализует оформление так же, как клиент: документ остаётся
  // валидным (data.type === 'doc'), а мусор в цветах и пределах не сохраняется.
  const { normalizeContentData: normalizeServerData } = await import(
    new URL('../../server/src/utils/content.js', import.meta.url)
  );
  const serverImportant = normalizeServerData('important', {
    ...docWith('Текст'),
    important: { background: '#fef3c7', borderWidth: 5, radius: 99 },
  });
  check(
    'server: оформление «Важного» нормализуется',
    serverImportant.ok &&
      serverImportant.data.type === 'doc' &&
      serverImportant.data.important.background === '#FEF3C7' &&
      serverImportant.data.important.borderWidth === 2 &&
      serverImportant.data.important.radius === 12,
  );

  const importantGlobalsCss = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
  const importantThemesCss = await readFile(new URL('../src/styles/themes.css', import.meta.url), 'utf8');
  const importantPrintCss = await readFile(new URL('../src/styles/print.css', import.meta.url), 'utf8');
  check(
    'css: «Важное» — рамка, скругление и палитра',
    /\.content-important\s*\{[^}]*border:\s*1px solid var\(--color-important-border\)/s.test(importantGlobalsCss) &&
      /\.content-important\s*\{[^}]*border-radius:\s*10px/s.test(importantGlobalsCss) &&
      !importantGlobalsCss.includes('.content-important__label') &&
      !importantGlobalsCss.includes('.content-card--important') &&
      importantGlobalsCss.includes('.important-palette__swatch') &&
      importantThemesCss.includes('--color-important-border: #cfbec7') &&
      importantThemesCss.includes('--color-important-border: #3d1830') &&
      /\.print-doc \.content-important[^{]*\{[^}]*print-color-adjust:\s*exact/s.test(importantPrintCss),
  );

  // Правка 10: чек-лист читателя интерактивен, сохранённая отметка
  // восстанавливается при повторном открытии блока.
  check(
    'theory (view): чек-лист с чекбоксами',
    readerTheory.includes('content-checklist--interactive') &&
      readerTheory.includes('class="content-checklist__check"') &&
      readerTheory.includes('type="checkbox"'),
  );
  setChecklistItemChecked('block-1', 'content-3', '1', true);
  const readerCheckedTheory = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check(
    'theory (view): сохранённая отметка восстановлена',
    readerCheckedTheory.includes('content-checklist--interactive') &&
      readerCheckedTheory.includes('class="is-checked"') &&
      readerCheckedTheory.includes('✓') &&
      readerCheckedTheory.includes('aria-label="Отметить пункт 1"'),
  );
  resetChecklistProgress('block-1');
  check(
    'theory (edit): авторский чек-лист без интерактивных чекбоксов',
    !theoryHtml.includes('content-checklist--interactive'),
  );

  // 9a2. Многоуровневый список в просмотре и печати (Правка 4)
  const { TiptapContent, default: ContentRenderer } = await vite.ssrLoadModule('/src/components/content/ContentRenderer.jsx');
  const listDoc = {
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { listId: 'list-view' },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Первый' }] }],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Второй' }] },
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Маркер' }] }] },
                ],
              },
              {
                type: 'orderedList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Вложенный' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const listHtml = renderToStaticMarkup(React.createElement(TiptapContent, { doc: listDoc }));
  check('lists (view): номер первого уровня', listHtml.includes('data-list-label="1."'));
  check('lists (view): вложенный номер', listHtml.includes('data-list-label="2.1."'));
  check('lists (view): маркированный уровень', listHtml.includes('data-list-label="–"'));
  check('lists (view): висячий отступ уровня', listHtml.includes('--list-indent:1.9em'));
  check(
    'lists (view): номера не попали в текст',
    listHtml.includes('>Первый<') && !listHtml.includes('>1.<') && !listHtml.includes('1. Первый'),
  );

  // CSS маркера: номер прижат к тексту справа и растёт влево, в отступ уровня,
  // иначе длинный номер («1.2.1.») наезжает на текст пункта.
  const globalsCss = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
  const markerAt = globalsCss.indexOf('li[data-list-label]::before');
  const markerBlock = globalsCss.slice(markerAt, globalsCss.indexOf('}', markerAt));
  check('lists (css): маркер прижат к тексту справа', markerBlock.includes('right: calc(100% + 0.5em)'));
  check('lists (css): маркер не растёт вправо от отступа', !markerBlock.includes('left:'));

  // Правка 9: в просмотре карточка без рамки и фона, тело без отступов.
  const viewCardAt = globalsCss.indexOf('.content-card--view {');
  const viewCardBlock =
    viewCardAt === -1 ? '' : globalsCss.slice(viewCardAt, globalsCss.indexOf('}', viewCardAt));
  check(
    'view (css): карточка без рамки и фона',
    viewCardBlock.includes('border: 0') && viewCardBlock.includes('background: transparent'),
  );
  check('view (css): тело карточки без отступов', globalsCss.includes('.content-card--view .content-card__body {'));

  // Видео: ширина колонки работает и без соседей по ряду, выравнивание — внутри
  // колонки: карточка остаётся на своём месте в ряду, а не «улетает» в центр.
  const { contentRowSpans, docToText } = await vite.ssrLoadModule('/src/utils/helpers.js');
  const spansOf = (items) => JSON.stringify(contentRowSpans(items));

  check(
    'video (grid): видео держит авторскую ширину',
    spansOf([{ type: 'video', width: 33 }]) === '[4]',
    spansOf([{ type: 'video', width: 33 }]),
  );
  check(
    'video (css): карточку не центрируют авто-отступы',
    !globalsCss.includes(".slide-row > .content-card--video[data-align='center']"),
  );
  check(
    'video (css): выравнивание внутри колонки',
    globalsCss.includes(".content-card--video[data-align='center'] .content-video") &&
      globalsCss.includes(".content-card--video[data-align='right'] .content-video"),
  );
  check(
    'video (css): плеер не схлопывается при выравнивании',
    globalsCss.includes('.content-card--video .video-embed') &&
      globalsCss.includes('.content-card--video .video-player'),
  );

  // Ряд слайда — сетка из 12 колонок: 33 % = 4 колонки, поэтому 4 + 4 + 4 = 12
  // стоят в одной строке. Проценты flexBasis не учитывали gap (99 % + 24px), и
  // третий блок переносился вниз; «плюсик» ряда живёт в отступе справа.
  const rowAt = globalsCss.indexOf('\n.slide-row {');
  const rowBlock = rowAt === -1 ? '' : globalsCss.slice(rowAt, globalsCss.indexOf('}', rowAt));
  check('layout (css): ряд — сетка из 12 колонок', rowBlock.includes('grid-template-columns: repeat(12'), rowBlock);
  check(
    'layout (css): плюсик ряда не отнимает место у блоков',
    globalsCss.includes('.slide-row--add {') &&
      globalsCss.includes('.slide-row > .content-plus {') &&
      globalsCss.includes('padding-right: 32px'),
  );
  check(
    'layout (css): открытое меню «плюсика» подсвечивает кнопку',
    globalsCss.includes('.content-plus--open .content-plus__trigger') && !globalsCss.includes('.content-plus[open]'),
  );
  check(
    'layout (grid): три блока по 33 % — в одной строке',
    spansOf([{ width: 33 }, { width: 33 }, { width: 33 }]) === '[4,4,4]',
    spansOf([{ width: 33 }, { width: 33 }, { width: 33 }]),
  );
  check('layout (grid): 66 + 33 заполняют ряд', spansOf([{ width: 66 }, { width: 33 }]) === '[8,4]');
  check('layout (grid): два блока по 33 % — половины', spansOf([{ width: 33 }, { width: 33 }]) === '[6,6]');
  check('layout (grid): блок 33 % без соседей — весь ряд', spansOf([{ width: 33 }]) === '[12]');
  check(
    'layout (grid): одиночный блок не шире ряда',
    contentRowSpans([{ width: 66 }, { width: 66 }, { width: 66 }]).every((span) => span <= 12),
  );

  // Ряд слайда: три колонки по 33 % должны оставаться в одной строке. Жёсткий
  // минимум карточки (180px) переносил третий блок вниз ещё до 640px.
  const cardAt = globalsCss.indexOf('\n.content-card {');
  const cardBlock = cardAt === -1 ? '' : globalsCss.slice(cardAt, globalsCss.indexOf('}', cardAt));
  check('layout (css): карточка сжимается до ширины колонки', cardBlock.includes('min-width: 0'));
  check('layout (css): у карточки нет минимума 180px', !cardBlock.includes('min-width: 180px'));

  // Правка 10: состояния пункта чек-листа в режиме читателя.
  const checkedItemAt = globalsCss.indexOf('.content-checklist--interactive .content-checklist__list li.is-checked {');
  const checkedItemBlock =
    checkedItemAt === -1 ? '' : globalsCss.slice(checkedItemAt, globalsCss.indexOf('}', checkedItemAt));
  check(
    'checklist (css): выполненный пункт — светло-зелёный фон',
    checkedItemBlock.includes('background: #e8f5e9') && checkedItemBlock.includes('color: #4b5563'),
  );

  const checkedBoxAt = globalsCss.indexOf(
    '.content-checklist--interactive .content-checklist__check input:checked + .content-checklist__box {',
  );
  const checkedBoxBlock =
    checkedBoxAt === -1 ? '' : globalsCss.slice(checkedBoxAt, globalsCss.indexOf('}', checkedBoxAt));
  check(
    'checklist (css): отмеченный чекбокс — зелёный с галочкой',
    checkedBoxBlock.includes('background: #2e7d32') && checkedBoxBlock.includes('color: #ffffff'),
  );
  check(
    'checklist (css): текст выполненного пункта зачёркнут',
    globalsCss.includes('.content-checklist--interactive .content-checklist__list li.is-checked .content-checklist__text') &&
      globalsCss.includes('text-decoration: line-through'),
  );

  // Примечания к тексту (Правка 5): метка на слове, номер после него и подсказка
  const noteDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Пожарная',
            marks: [{ type: 'inlineNote', attrs: { noteId: 'note-a', text: 'Термин из ГОСТ' } }],
          },
          { type: 'text', text: ' безопасность ' },
          {
            type: 'text',
            text: 'важна',
            marks: [{ type: 'inlineNote', attrs: { noteId: 'note-b', text: 'Не путать с охраной труда' } }],
          },
        ],
      },
    ],
  };

  const noteHtml = renderToStaticMarkup(React.createElement(TiptapContent, { doc: noteDoc }));
  check(
    'notes (view): слово размечено меткой',
    noteHtml.includes('class="inline-note"') && noteHtml.includes('data-note-id="note-a"'),
  );
  check('notes (view): текст примечания в разметке', noteHtml.includes('data-note-text="Термин из ГОСТ"'));
  check(
    'notes (view): номер-индекс после слова',
    noteHtml.includes('class="inline-note__mark"') && noteHtml.includes('data-note-number="1"'),
  );
  check('notes (view): второе примечание нумеруется 2', noteHtml.includes('data-note-number="2"'));
  check(
    'notes (view): номер не попал в текст слова',
    noteHtml.includes('>Пожарная</span>') && !noteHtml.includes('>Пожарная1<'),
  );

  // Примечания заголовка карточки памятки идут первыми, тело продолжает нумерацию
  const { collectSlideNotes } = await vite.ssrLoadModule('/src/utils/notes.js');
  const offsetNotes = collectSlideNotes([{ id: 'offset-content', type: 'text', data: noteDoc }], 2);
  check(
    'notes: смещение продолжает нумерацию после заголовка',
    offsetNotes.offsetById.get('offset-content') === 2 &&
      offsetNotes.numberById.get('note-a') === 3 &&
      offsetNotes.numberById.get('note-b') === 4 &&
      offsetNotes.total === 4,
  );

  const noteMarkAt = globalsCss.indexOf('.inline-note__mark {');
  const noteMarkBlock = globalsCss.slice(noteMarkAt, globalsCss.indexOf('}', noteMarkAt));
  check('notes (css): номер примечания — верхний индекс', noteMarkBlock.includes('vertical-align: super'));
  check('notes (css): цвет номера — акцент темы', noteMarkBlock.includes('var(--color-primary)'));
  check('notes (css): подсказка примечания объявлена', globalsCss.includes('.note-tip {'));

  // Поле примечания: текстовое поле, счётчик и удаление в режиме правки
  const { default: NotePopover } = await vite.ssrLoadModule('/src/components/editor/toolbar/NotePopover.jsx');
  const popoverHtml = renderToStaticMarkup(
    React.createElement(NotePopover, {
      mode: 'edit',
      initialText: 'Текст примечания',
      onSave: () => {},
      onDelete: () => {},
      onClose: () => {},
    }),
  );
  check(
    'notes (view): поле примечания с удалением',
    popoverHtml.includes('note-popover__text') &&
      popoverHtml.includes('Текст примечания') &&
      popoverHtml.includes('Удалить'),
  );

  // Примечания в остальных типах контента (Правка 5): таблица, чек-лист, реплика.
  // Номера сквозные по слайду: noteOffset — примечания предыдущих фрагментов.
  const tableNoteContent = {
    id: 'content-table-notes',
    type: 'table',
    data: {
      columns: 2,
      rows: 1,
      headerRow: false,
      cells: [['Пожарная безопасность', 'Вторая ячейка']],
      notes: [
        { id: 'note-t1', text: 'Определение из ГОСТ', field: 'cell', ref: '0-0', from: 0, to: 8, word: 'Пожарная' },
      ],
    },
  };
  const tableNoteHtml = renderToStaticMarkup(
    React.createElement(ContentRenderer, { content: tableNoteContent, noteOffset: 2 }),
  );
  check(
    'notes (view): примечание в ячейке таблицы',
    tableNoteHtml.includes('class="inline-note"') && tableNoteHtml.includes('data-note-id="note-t1"'),
  );
  check(
    'notes (view): номер в ячейке сквозной по слайду',
    tableNoteHtml.includes('data-note-number="3"'),
    tableNoteHtml.slice(0, 200),
  );
  check(
    'notes (view): номер не попал в текст ячейки',
    tableNoteHtml.includes('>Пожарная</span>') && !tableNoteHtml.includes('Пожарная3'),
  );

  const checklistNoteContent = {
    id: 'content-checklist-notes',
    type: 'checklist',
    data: {
      title: 'Чек-лист',
      columns: 1,
      items: [{ id: '1', text: 'Проверить огнетушитель', checked: false }],
      notes: [
        { id: 'note-c1', text: 'Пункт инструкции 4.2', field: 'item', ref: '1', from: 9, to: 21, word: 'огнетушитель' },
      ],
    },
  };
  const checklistNoteHtml = renderToStaticMarkup(
    React.createElement(ContentRenderer, { content: checklistNoteContent, noteOffset: 0 }),
  );
  check(
    'notes (view): примечание в пункте чек-листа',
    checklistNoteHtml.includes('class="inline-note"') && checklistNoteHtml.includes('>огнетушитель</span>'),
  );
  check('notes (view): номер примечания в чек-листе', checklistNoteHtml.includes('data-note-number="1"'));

  const { default: NoteTip } = await vite.ssrLoadModule('/src/components/content/NoteTip.jsx');
  const tipHtml = renderToStaticMarkup(
    React.createElement(NoteTip, { tip: { text: 'Текст примечания', top: 10, left: 10, width: 280 }, onClose: () => {} }),
  );
  check(
    'notes (view): в подсказке только текст примечания',
    tipHtml.includes('note-tip__text') && !tipHtml.includes('Примечание 1') && !tipHtml.includes('note-tip__head'),
    tipHtml,
  );
  check(
    'notes (view): подсказку можно закрыть',
    tipHtml.includes('note-tip__close') && tipHtml.includes('Закрыть примечание'),
  );

  check('notes (css): поле с примечанием объявлено', globalsCss.includes('.note-field__badge {'));
  check('notes (css): кнопка примечания у поля', globalsCss.includes('.note-field__add {'));

  // ===== Внутренние ссылки (Правка 6) =====
  const linkDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Открыть ' },
          {
            type: 'text',
            text: 'тест',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: '/block/b1?question=q1',
                  linkKind: 'internal',
                  targetType: 'question',
                  targetId: 'q1',
                  targetBlockId: 'b1',
                  targetLabel: 'Тест → Вопрос 2',
                  targetBadge: 'Вопрос',
                },
              },
            ],
          },
          { type: 'text', text: ' и ' },
          {
            type: 'text',
            text: 'сайт',
            marks: [{ type: 'link', attrs: { href: 'https://example.com', linkKind: 'external', newTab: true } }],
          },
        ],
      },
    ],
  };

  const linkHtml = renderToStaticMarkup(React.createElement(TiptapContent, { doc: linkDoc }));
  check(
    'links (view): внутренняя ссылка — span с подсказкой',
    linkHtml.includes('content-link content-link--internal') &&
      linkHtml.includes('title="Ведёт на: Тест → Вопрос 2"') &&
      !linkHtml.includes('href="/block/b1?question=q1"'),
    linkHtml,
  );
  check(
    'links (view): ссылка — только подчёркнутое слово, без плашки типа',
    !linkHtml.includes('content-link__type') && !linkHtml.includes('Показывать тип цели'),
    linkHtml,
  );
  check(
    'links (view): внешняя ссылка открывается в новой вкладке',
    linkHtml.includes('href="https://example.com"') &&
      linkHtml.includes('target="_blank"') &&
      linkHtml.includes('rel="noopener noreferrer"'),
  );

  const linkedHtml = renderToStaticMarkup(
    React.createElement(TiptapContent, { doc: linkDoc, onLinkClick: () => {} }),
  );
  check(
    'links (view): с обработчиком внутренняя ссылка кликабельна',
    linkedHtml.includes('<a href="/block/b1?question=q1"') && linkedHtml.includes('content-link--internal'),
    linkedHtml.slice(0, 240),
  );

  const tableLinkContent = {
    id: 'content-table-links',
    type: 'table',
    data: {
      columns: 1,
      rows: 1,
      headerRow: false,
      cells: [['Пожарная безопасность']],
      notes: [{ id: 'note-l1', text: 'Определение из ГОСТ', field: 'cell', ref: '0-0', from: 0, to: 8, word: 'Пожарная' }],
      links: [
        {
          id: 'link-l1',
          field: 'cell',
          ref: '0-0',
          from: 0,
          to: 8,
          word: 'Пожарная',
          kind: 'internal',
          href: '/block/b1?slide=s1',
          targetType: 'slide',
          targetId: 's1',
          targetBlockId: 'b1',
          targetLabel: 'Теория → Слайд 1',
          targetBadge: 'Слайд',
        },
      ],
    },
  };
  const tableLinkHtml = renderToStaticMarkup(React.createElement(ContentRenderer, { content: tableLinkContent }));
  check(
    'links (view): ссылка и примечание в одной ячейке',
    tableLinkHtml.includes('content-link content-link--internal') &&
      !tableLinkHtml.includes('content-link__type') &&
      tableLinkHtml.includes('class="inline-note"') &&
      tableLinkHtml.includes('data-note-id="note-l1"'),
    tableLinkHtml,
  );

  check('links (css): стиль ссылки объявлен', globalsCss.includes('.content-link {'));
  check('links (css): стиля плашки типа цели нет', !globalsCss.includes('.content-link__type'));
  check('links (css): дерево курса в диалоге', globalsCss.includes('.link-tree__block-btn {'));
  check('links (css): кнопка «Назад» в шапке', globalsCss.includes('.app-header__back {'));

  // Диалог ссылки: дерево курса, выбранная цель и настройки отображения
  const { default: LinkDialog } = await vite.ssrLoadModule('/src/components/editor/toolbar/LinkDialog.jsx');
  const { useLinkStore } = await vite.ssrLoadModule('/src/store/linkStore.js');

  seed(useLinkStore, {
    courseId: 'course-1',
    map: {
      id: 'course-1',
      title: 'Восточный Экспресс',
      blocks: [
        {
          id: 'b1',
          type: 'theory',
          title: 'Настройка системы',
          items: [
            { id: 's1', index: 0, title: 'Введение' },
            { id: 's2', index: 1, title: '' },
          ],
        },
        {
          id: 'b2',
          type: 'test',
          title: 'Тест по модулю 1',
          items: [{ id: 'q1', index: 0, title: 'Кто такой клиент' }],
        },
      ],
    },
    mapLoading: false,
    mapError: null,
    dialog: {
      mode: 'create',
      initial: {
        kind: 'internal',
        href: '',
        newTab: true,
        text: 'перейти',
        hasLink: false,
        target: {
          targetType: 'slide',
          targetId: 's1',
          targetBlockId: 'b1',
          targetLabel: 'Настройка системы → Слайд 1',
          targetBadge: 'Слайд',
        },
      },
      apply: () => true,
      remove: () => true,
    },
  });

  const linkDialogHtml = renderToStaticMarkup(React.createElement(LinkDialog));
  check(
    'links (dialog): вкладки типов ссылок',
    linkDialogHtml.includes('Внешняя ссылка') && linkDialogHtml.includes('Внутренняя ссылка'),
  );
  check(
    'links (dialog): дерево курса с элементами',
    linkDialogHtml.includes('Настройка системы') &&
      linkDialogHtml.includes('Слайд 1: Введение') &&
      linkDialogHtml.includes('Вопрос 1: Кто такой клиент'),
    linkDialogHtml.slice(0, 300),
  );
  check(
    'links (dialog): выбранная цель без галочки «тип цели»',
    linkDialogHtml.includes('Настройка системы → Слайд 1') && !linkDialogHtml.includes('Показывать тип цели'),
  );
  check(
    'links (dialog): текст ссылки и кнопки',
    linkDialogHtml.includes('Текст ссылки') &&
      linkDialogHtml.includes('value="перейти"') &&
      linkDialogHtml.includes('Сохранить'),
  );

  // Кнопка «← Назад» после перехода по внутренней ссылке
  const { default: BackLink } = await vite.ssrLoadModule('/src/components/layout/BackLink.jsx');

  seed(useLinkStore, { history: [] });
  const backEmptyHtml = render(BackLink, '/block/b1');
  check('links (back): без переходов кнопки нет', !backEmptyHtml.includes('app-header__back'));

  seed(useLinkStore, {
    history: [
      { pathname: '/block/b1', search: '?slide=s1' },
      { pathname: '/block/b2', search: '' },
    ],
  });
  const backHtml = render(BackLink, '/block/b3');
  const popped = useLinkStore.getState().popHistory();
  check(
    'links (back): кнопка и последний переход в истории',
    backHtml.includes('app-header__back') &&
      backHtml.includes('Назад') &&
      popped?.pathname === '/block/b2' &&
      useLinkStore.getState().history.length === 1,
    JSON.stringify(popped),
  );

  for (let index = 0; index < 25; index += 1) {
    useLinkStore.getState().pushHistory({ pathname: `/block/step-${index}`, search: '' });
  }
  check(
    'links (back): история переходов не растёт бесконечно',
    useLinkStore.getState().history.length === 20 &&
      useLinkStore.getState().history[19].pathname === '/block/step-24',
    String(useLinkStore.getState().history.length),
  );

  seed(useLinkStore, { history: [] });

  // Диалог открывается только по запросу: остальным проверкам он не мешает
  seed(useLinkStore, { dialog: null });

  // ===== Справка о блоке (Правка 7) =====
  const { useHelpStore } = await vite.ssrLoadModule('/src/store/helpStore.js');

  check('help (css): инструменты шапки', globalsCss.includes('.app-header__tools {'));
  check('help (css): модалка справки', globalsCss.includes('.help-modal {') && globalsCss.includes('.help-note--link {'));

  // Шапка закреплена, панели содержания отступают на её высоту
  check(
    'header (css): шапка закреплена вверху окна',
    /\.app-header \{[^}]*position: sticky/.test(globalsCss) && globalsCss.includes('--app-header-h'),
  );
  check(
    'header (css): содержание и инструменты отступают на высоту шапки',
    /\.theory__side[^{]*\{[^}]*top: calc\(var\(--app-header-h\) \+ var\(--toolbar-h\) \+ 16px\)/.test(globalsCss) &&
      /\.toolbar \{[^}]*top: calc\(var\(--app-header-h\) \+ 8px\)/.test(globalsCss),
  );
  check(
    'header (css): панель инструментов не наезжает на содержание',
    globalsCss.includes('--toolbar-h: 0px') &&
      /\.test-side \{[^}]*var\(--toolbar-h\)/.test(globalsCss) &&
      /\.glossary-letters \{[^}]*var\(--toolbar-h\)/.test(globalsCss),
  );

  seed(useBlockStore, {
    currentBlock: theoryBlock,
    blocks: sampleBlocks,
    blockLoading: false,
    blockError: null,
    blockNotFound: false,
  });
  seed(useAuthStore, { isEditor: true, isAuthenticated: true });
  seed(useUiStore, { uiMode: 'edit', modal: null });

  // Кнопки справки и настроек живут в шапке и появляются только на странице блока
  const blockPageHtml = render(App, '/block/block-1');
  check(
    'help (header): темы, настройки и справка на странице блока',
    blockPageHtml.includes('app-header__tools') &&
      blockPageHtml.includes('Темы оформления') &&
      blockPageHtml.includes('Настройки блока') &&
      blockPageHtml.includes('Справка о блоке'),
  );
  const dashboardHeaderHtml = render(App, '/');
  check('help (header): на дашборде кнопки блока скрыты', !dashboardHeaderHtml.includes('Справка о блоке'));

  seed(useAuthStore, { isEditor: false, isAuthenticated: true });
  seed(useUiStore, { uiMode: 'view', modal: null });
  const readerBlockHtml = render(App, '/block/block-1');
  check(
    'help (header): читателю доступна справка, но не настройки',
    readerBlockHtml.includes('Справка о блоке') && !readerBlockHtml.includes('Настройки блока'),
  );

  seed(useAuthStore, { isEditor: true, isAuthenticated: true });
  seed(useUiStore, { uiMode: 'edit', modal: null });

  const sampleHelp = {
    block: { id: 'block-1', title: 'Введение', type: 'theory' },
    updatedAt: '2026-11-12T14:30:00.000Z',
    notes: [
      { noteId: 'n1', number: 1, text: 'Первое примечание', place: 'слайд 1', href: '/block/block-1?slide=slide-1' },
      { noteId: 'n2', number: 2, text: 'Второе примечание', place: 'слайд 2', href: '/block/block-1?slide=slide-2' },
    ],
    mentions: [
      {
        blockId: 'block-2',
        blockTitle: 'Настройка системы',
        blockType: 'theory',
        place: 'слайд 2',
        href: '/block/block-2?slide=s-2',
      },
      {
        blockId: 'block-3',
        blockTitle: 'Ключевые термины',
        blockType: 'memo',
        place: 'ячейка 3',
        href: '/block/block-3?memo=c-3',
      },
    ],
    totals: { notes: 2, mentions: 2 },
  };

  seed(useHelpStore, { blockId: 'block-1', help: sampleHelp, loading: false, error: null });
  seed(useUiStore, { modal: { name: 'block-help', payload: theoryBlock } });

  const helpHtml = render(App, '/block/block-1');
  check('help: заголовок с названием блока', helpHtml.includes('Справка: Введение'));
  check(
    'help: дата последнего изменения',
    helpHtml.includes('Дата последнего изменения:') && helpHtml.includes('12.11.2026'),
  );
  check('help: два раздела', helpHtml.includes('Сноски (примечания)') && helpHtml.includes('Упоминается в'));
  check(
    'help: нумерованный список сносок',
    helpHtml.includes('>1.<') && helpHtml.includes('Первое примечание') && helpHtml.includes('>2.<'),
  );
  check(
    'help (edit): сноски ведут к месту примечания',
    (helpHtml.match(/help-note--link/g) ?? []).length === 2 && helpHtml.includes('слайд 2'),
  );
  check(
    'help: упоминания с типом блока и местом',
    helpHtml.includes('Блок «Настройка системы» (слайд 2)') &&
      helpHtml.includes('Памятка «Ключевые термины» (ячейка 3)'),
  );

  seed(useUiStore, { uiMode: 'view' });
  const helpViewHtml = render(App, '/block/block-1');
  check(
    'help (view): сноски без перехода, упоминания остаются кнопками',
    !helpViewHtml.includes('help-note--link') && (helpViewHtml.match(/help-mention/g) ?? []).length >= 2,
  );

  seed(useUiStore, { uiMode: 'edit' });
  seed(useHelpStore, {
    blockId: 'block-1',
    help: { ...sampleHelp, notes: [], mentions: [], totals: { notes: 0, mentions: 0 } },
    loading: false,
    error: null,
  });
  const helpEmptyHtml = render(App, '/block/block-1');
  check(
    'help: пустые состояния',
    helpEmptyHtml.includes('Примечаний нет') && helpEmptyHtml.includes('Нет упоминаний'),
  );

  seed(useHelpStore, { blockId: 'block-1', help: null, loading: true, error: null });
  const helpLoadingHtml = render(App, '/block/block-1');
  check('help: состояние загрузки', helpLoadingHtml.includes('Загружаем справку') && helpLoadingHtml.includes('help-status'));

  seed(useHelpStore, { blockId: 'block-1', help: null, loading: false, error: 'Сервер недоступен' });
  const helpErrorHtml = render(App, '/block/block-1');
  check(
    'help: ошибка загрузки с повтором',
    helpErrorHtml.includes('alert--error') && helpErrorHtml.includes('Сервер недоступен') && helpErrorHtml.includes('Повторить'),
  );

  // Стор не держит данные закрытой модалки
  useHelpStore.getState().reset();
  check(
    'help (store): reset очищает справку',
    useHelpStore.getState().help === null && useHelpStore.getState().blockId === null,
  );

  seed(useHelpStore, { blockId: null, help: null, loading: false, error: null });
  seed(useUiStore, { modal: null, uiMode: 'edit' });

  // 9b. Читатель без слайдов
  seed(useAuthStore, { isEditor: false, isAuthenticated: true });
  seed(useContentStore, { slides: [], activeSlideId: null, loading: false, loaded: true, error: null });
  const emptyTheory = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check(
    'theory: пустое состояние без кнопки добавления',
    emptyTheory.includes('В блоке пока нет слайдов') && !emptyTheory.includes('Добавить слайд'),
  );

  // 9c. Ошибка загрузки слайдов
  seed(useAuthStore, { isEditor: true, isAuthenticated: true });
  seed(useContentStore, { slides: [], activeSlideId: null, loading: false, loaded: true, error: 'Сервер недоступен' });
  const slidesError = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check('theory: алерт ошибки слайдов', slidesError.includes('Сервер недоступен') && slidesError.includes('Повторить'));

  // 9d. Заглушка для блока неизвестного типа
  const placeholderHtml = render(BlockPlaceholder, '/block/block-2', { block: { type: 'webinar' } });
  check('block (unknown): заглушка без редактора', placeholderHtml.includes('нет редактора'));

  // 9e. Блок не найден
  seed(useBlockStore, { currentBlock: null, blockLoading: false, blockError: null, blockNotFound: true });
  seed(useContentStore, { slides: sampleSlides, activeSlideId: 'slide-1', loaded: true, error: null });
  const missingBlockHtml = render(App, '/block/unknown');
  check(
    'block: пустое состояние «не найден»',
    missingBlockHtml.includes('Блок не найден') && missingBlockHtml.includes('К списку курсов'),
  );

  // 9f. Шаг 10: полноценные редакторы не-текстовых типов
  const { getVideoEmbed } = await vite.ssrLoadModule('/src/utils/helpers.js');

  check(
    'video helper: youtu.be',
    getVideoEmbed('https://youtu.be/abc123')?.embedUrl === 'https://www.youtube.com/embed/abc123',
  );
  check(
    'video helper: shorts',
    getVideoEmbed('https://www.youtube.com/shorts/xyz789')?.embedUrl === 'https://www.youtube.com/embed/xyz789',
  );
  check('video helper: vimeo', getVideoEmbed('https://vimeo.com/98765')?.provider === 'vimeo');
  check('video helper: прямой файл', getVideoEmbed('https://cdn.test/clip.mp4')?.provider === 'file');
  check('video helper: мусор отклонён', getVideoEmbed('просто текст') === null);

  const step10Contents = [
    {
      id: 'content-image',
      slideId: 'slide-10',
      type: 'image',
      data: { fileId: 'file-1', url: '/uploads/pixel.png', alt: 'Схема', caption: 'Схема процесса', width: 50, align: 'left' },
      dataVersion: 1,
      width: 50,
      order: 0,
    },
    {
      id: 'content-video',
      slideId: 'slide-10',
      type: 'video',
      data: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'Инструктаж', align: 'right' },
      dataVersion: 1,
      width: 50,
      order: 1,
    },
    {
      id: 'content-table',
      slideId: 'slide-10',
      type: 'table',
      data: { columns: 2, rows: 2, cells: [['Шаг', 'Срок'], ['Первый', '1 день']], headerRow: true },
      dataVersion: 1,
      width: 100,
      order: 2,
    },
    {
      id: 'content-checklist',
      slideId: 'slide-10',
      type: 'checklist',
      data: {
        title: 'Перед стартом',
        columns: 2,
        items: [
          { id: '1', text: 'Каска', checked: true },
          { id: '2', text: 'Перчатки', checked: false },
        ],
      },
      dataVersion: 1,
      width: 100,
      order: 3,
    },
    {
      id: 'content-code',
      slideId: 'slide-10',
      type: 'code',
      data: { language: 'javascript', filename: 'index.js', code: 'const a = 1;' },
      dataVersion: 1,
      width: 50,
      order: 4,
    },
    {
      id: 'content-replica',
      slideId: 'slide-10',
      type: 'replica',
      data: {
        lines: [
          {
            id: 'line-1',
            character: 'Инспектор',
            side: 'right',
            position: 'auto',
            avatar: '',
            text: 'Соблюдайте правила.',
          },
        ],
        avatarSize: 72,
        bubbleColor: '',
        borderColor: '',
        borderWidth: 2,
        radius: 16,
        showTail: true,
        tail: 'auto',
        textAlign: 'left',
      },
      dataVersion: 1,
      width: 50,
      order: 5,
    },
  ];

  seed(useAuthStore, { isEditor: true, isAuthenticated: true });
  seed(useUiStore, { uiMode: 'edit' });
  seed(useContentStore, {
    blockId: 'block-1',
    slides: [
      { id: 'slide-10', blockId: 'block-1', title: 'Шаг 10', order: 0, contents: step10Contents, contentCount: 6 },
    ],
    activeSlideId: 'slide-10',
    loading: false,
    loaded: true,
    error: null,
  });

  const step10Edit = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check('step10: редактор картинки', step10Edit.includes('Описание для скринридера') && step10Edit.includes('Заменить'));
  check(
    'step10: редактор видео с плеером',
    step10Edit.includes('Ссылка на видео') && step10Edit.includes('youtube.com/embed/dQw4w9WgXcQ'),
  );
  check(
    'step10: выравнивание видео внутри колонки',
    step10Edit.includes('Выравнивание в колонке') &&
      step10Edit.includes('value="right"') &&
      step10Edit.includes('>Справа<'),
  );
  check(
    'step10: редактор таблицы с ячейками',
    step10Edit.includes('Первая строка — заголовок') &&
      (step10Edit.match(/class="table-editor__cell(?=[ "])/g) ?? []).length === 4,
    (step10Edit.match(/class="table-editor__cell[^"]*"/g) ?? []).slice(0, 6),
  );
  check(
    'step10: кнопки объединения и буфера обмена',
    step10Edit.includes('Объединить') &&
      step10Edit.includes('Разделить') &&
      step10Edit.includes('Скопировать') &&
      step10Edit.includes('Вставить из буфера'),
  );
  check('step10: чек-лист', step10Edit.includes('Добавить пункт') && step10Edit.includes('Перед стартом'));
  check('step10: редактор кода', step10Edit.includes('Имя файла') && step10Edit.includes('const a = 1;'));
  check('step10: реплика', step10Edit.includes('Текст реплики') && step10Edit.includes('Инспектор'));
  check('step10: заглушек Шага 10 нет', !step10Edit.includes('Шаге 10') && !step10Edit.includes('content-hint'));

  // Правка «Изображение», часть 1: ручки размера, обрезка, пропорции, маркеры
  check(
    'image (edit): восемь ручек размера',
    (step10Edit.match(/image-editor__handle--/g) ?? []).length === 8,
    (step10Edit.match(/image-editor__handle--[a-z]+/g) ?? []).join(','),
  );
  check(
    'image (edit): обрезка и сохранение пропорций',
    step10Edit.includes('Обрезать') && step10Edit.includes('Сохранять пропорции'),
  );
  check(
    'image (edit): панель маркеров и подсказка',
    step10Edit.includes('Маркеры') &&
      step10Edit.includes('Добавить маркер') &&
      step10Edit.includes('Клик по картинке — новый маркер'),
  );
  check(
    'image (edit): кнопки выравнивания',
    step10Edit.includes('aria-label="Выравнивание картинки"') &&
      (step10Edit.match(/aria-pressed=/g) ?? []).length >= 3,
  );
  check('image (edit): SVG среди форматов загрузки', step10Edit.includes('image/svg+xml'));
  check(
    'image (edit): панель рамок выделения',
    step10Edit.includes('Рамки выделения') &&
      step10Edit.includes('Добавить рамку') &&
      step10Edit.includes('image-shapes__add') &&
      step10Edit.includes('Пока пусто: выберите фигуру'),
  );
  check(
    'image (edit): слой рамок над картинкой',
    step10Edit.includes('image-editor__shapes') && step10Edit.includes('Рамки выделения'),
  );

  seed(useUiStore, { uiMode: 'view' });
  const step10View = render(TheoryBlock, '/block/block-1', { block: theoryBlock });
  check('step10 (view): iframe плеера', step10View.includes('https://www.youtube.com/embed/dQw4w9WgXcQ'));
  check(
    'step10 (view): карточка видео с выравниванием',
    step10View.includes('content-card--video') && step10View.includes('data-align="right"'),
  );
  check(
    'step10 (view): картинка с alt и шириной',
    step10View.includes('alt="Схема"') && step10View.includes('width:50%'),
  );
  check(
    'step10 (view): таблица с шапкой',
    step10View.includes('<th') && step10View.includes('>Шаг<'),
    step10View.slice(step10View.indexOf('<th'), step10View.indexOf('<th') + 120),
  );
  check(
    'step10 (view): чек-лист в два столбца с чекбоксами',
    step10View.includes('content-checklist--two') &&
      step10View.includes('content-checklist--interactive') &&
      step10View.includes('type="checkbox"'),
  );
  check('step10 (view): код с языком и файлом', step10View.includes('JavaScript') && step10View.includes('index.js'));
  check(
    'step10 (view): диалог справа',
    step10View.includes('content-dialog__item--right') &&
      step10View.includes('Соблюдайте правила.') &&
      step10View.includes('Инспектор'),
  );
  check(
    'step10 (view): диалог — облако с хвостиком и аватар-заглушка',
    step10View.includes('content-dialog__bubble') &&
      // Реплика справа: персонаж стоит справа от облака, хвостик смотрит на него.
      step10View.includes('data-tail="right"') &&
      step10View.includes('content-dialog__avatar-letter'),
  );

  // Аватар в кружке: автор выбирает, какая часть картинки видна (avatarFocus)
  // и насколько крупно (avatarZoom) — кружок не режет картинку по центру.
  const { default: DialogView } = await vite.ssrLoadModule('/src/components/content/DialogView.jsx');
  const avatarHtml = (line) =>
    renderToStaticMarkup(
      React.createElement(DialogView, {
        data: { lines: [{ id: 'line-1', character: 'Клиент', avatar: 'data:image/png;base64,AAAA', ...line }] },
      }),
    );

  const focusHtml = avatarHtml({ avatarFocus: { x: 20, y: 80 }, avatarZoom: 2 });
  check('dialog (avatar): выбранная область картинки', focusHtml.includes('object-position:20% 80%'), focusHtml);
  check('dialog (avatar): масштаб внутри кружка', focusHtml.includes('scale(2)'));
  check('dialog (avatar): без выбора области — центр картинки', avatarHtml({}).includes('object-position:50% 50%'));
  check(
    'dialog (avatar): кривые значения приводятся к пределам',
    avatarHtml({ avatarFocus: { x: 300, y: -40 }, avatarZoom: 9 }).includes('object-position:100% 0%'),
  );
  check(
    'dialog (css): кружок обрезает картинку',
    globalsCss.includes('.content-dialog__avatar-img') && globalsCss.includes('object-fit: cover'),
  );

  // Правка «Работа с таблицей»: ячейка — Tiptap-документ, объединения — data.merges.
  // В просмотре видно форматирование внутри ячейки и объединённую ячейку.
  const richTableContent = {
    id: 'content-table-rich',
    type: 'table',
    data: {
      columns: 2,
      rows: 2,
      headerRow: false,
      cells: [
        [
          {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Итог', marks: [{ type: 'bold' }] }] },
            ],
          },
          { type: 'doc', content: [{ type: 'paragraph' }] },
        ],
        [
          { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Год' }] }] },
          { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Сумма' }] }] },
        ],
      ],
      merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
    },
  };
  const richTableHtml = renderToStaticMarkup(
    React.createElement(ContentRenderer, { content: richTableContent }),
  );
  check(
    'table (view): объединённая ячейка на две колонки',
    // React отдаёт разметку с colSpan в camelCase — в HTML регистр атрибутов не важен
    /colspan="2"/i.test(richTableHtml) && (richTableHtml.match(/<td/gi) ?? []).length === 3,
    richTableHtml.slice(0, 240),
  );
  check(
    'table (view): форматирование внутри ячейки',
    richTableHtml.includes('<strong>Итог</strong>'),
    richTableHtml.slice(0, 240),
  );

  // Правка «Изображение», часть 1: маркеры — примечания с координатами,
  // номер общий со слайдом, подсказка та же, что у примечаний текста.
  const imageContent = {
    id: 'content-image-markers',
    type: 'image',
    data: {
      url: '/uploads/scheme.png',
      alt: 'Схема этажа',
      caption: 'План этажа',
      width: 60,
      align: 'left',
      notes: [
        { id: 'marker-1', text: 'Серверная комната', field: 'marker', x: 25, y: 40 },
        { id: 'marker-2', text: 'Панель управления', field: 'marker', x: 75.5, y: 60 },
      ],
      shapes: [
        { id: 'shape-1', type: 'rect', x: 10, y: 20, w: 30, h: 15, rotation: 0, color: '#E03131', fill: 20, stroke: 2 },
        { id: 'shape-2', type: 'triangle', x: 55, y: 55, w: 20, h: 20, rotation: 45, color: '#2F71C8', fill: 0, stroke: 3 },
      ],
    },
  };
  const imageHtml = renderToStaticMarkup(React.createElement(ContentRenderer, { content: imageContent }));

  check(
    'image (view): маркеры — только кружки с номерами',
    (imageHtml.match(/content-image__marker-number/g) ?? []).length === 2 &&
      !imageHtml.includes('content-image__marker-dot'),
    imageHtml.slice(0, 240),
  );
  check(
    'image (view): номера и координаты маркеров',
    imageHtml.includes('data-note-number="1"') &&
      imageHtml.includes('left:25%') &&
      imageHtml.includes('left:75.5%') &&
      imageHtml.includes('top:60%'),
  );
  check(
    'image (view): текст маркера для подсказки',
    imageHtml.includes('data-note-text="Серверная комната"') && imageHtml.includes('data-note-id="marker-2"'),
  );
  check(
    'image (view): лупа для полного размера',
    imageHtml.includes('aria-label="Открыть в полном размере"'),
  );
  check('image (view): ширина картинки из data', imageHtml.includes('width:60%'), imageHtml.slice(0, 200));
  check('image (view): подпись осталась', imageHtml.includes('План этажа'));
  check(
    'image (view): рамки выделения на картинке',
    (imageHtml.match(/image-shape__svg/g) ?? []).length === 2,
    (imageHtml.match(/data-shape-type="[a-z]+"/g) ?? []).join(','),
  );
  check(
    'image (view): фигура, цвет и поворот рамки',
    imageHtml.includes('data-shape-type="triangle"') &&
      imageHtml.includes('#2F71C8') &&
      imageHtml.includes('rotate(45deg)'),
  );
  check(
    'image (view): заливка и контур рамки',
    imageHtml.includes('fill-opacity="0.2"') && imageHtml.includes('stroke-width="3"'),
    imageHtml.slice(imageHtml.indexOf('image-shape'), imageHtml.indexOf('image-shape') + 400),
  );
  check(
    'image (view): рамки лежат под маркерами',
    imageHtml.indexOf('content-image__shapes') < imageHtml.indexOf('content-image__marker-number'),
  );

  // Обрезка в редакторе: картинка сдвигается абсолютно и не задаёт высоту рамки,
  // поэтому высоту держит сама рамка (aspect-ratio), иначе превью схлопывается
  // и вместо фотографии виден серый фон пунктирной рамки.
  const { default: ImageEditor } = await vite.ssrLoadModule(
    '/src/components/content/editors/ImageEditor.jsx',
  );
  const croppedEditorHtml = renderToStaticMarkup(
    React.createElement(ImageEditor, {
      content: {
        id: 'content-image-cropped',
        type: 'image',
        data: {
          url: '/uploads/scheme.png',
          alt: 'Схема этажа',
          width: 80,
          align: 'center',
          crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
          aspect: 0.5,
        },
      },
      onChange: () => {},
    }),
  );
  const editorFrameAt = croppedEditorHtml.indexOf('image-editor__frame');
  const editorFrameTag =
    editorFrameAt === -1
      ? ''
      : croppedEditorHtml.slice(editorFrameAt, croppedEditorHtml.indexOf('>', editorFrameAt));
  check(
    'image (edit): рамка превью держит высоту при обрезке',
    editorFrameTag.includes('aspect-ratio:2'),
    croppedEditorHtml.slice(0, 240),
  );
  check(
    'image (edit): картинка обрезана внутри рамки превью',
    croppedEditorHtml.includes('image-editor__image') &&
      croppedEditorHtml.includes('width:200%') &&
      croppedEditorHtml.includes('left:-20%'),
  );

  // Чистые функции картинки: обрезка, пропорции, маркеры
  const imageUtils = await vite.ssrLoadModule('/src/utils/image.js');
  check(
    'image helper: обрезка сохраняется долями',
    JSON.stringify(imageUtils.normalizeCrop({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 })) ===
      JSON.stringify({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 }),
  );
  check('image helper: обрезка во всю картинку — без обрезки', imageUtils.normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }) === null);
  check(
    'image helper: обрезка не выходит за границы',
    imageUtils.normalizeCrop({ x: 0.8, y: 0, w: 0.9, h: 1 })?.w === 0.2,
  );
  check(
    'image helper: картинка сдвигается при обрезке',
    imageUtils.cropImageStyle({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 })?.left === '-50%',
    JSON.stringify(imageUtils.cropImageStyle({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 })),
  );
  check(
    'image helper: рамка учитывает обрезку',
    imageUtils.imageFrameRatio({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }, 0.5) === 2,
  );
  check('image helper: свободные пропорции важнее натуральных', imageUtils.imageFrameRatio({ aspect: 0.5 }, 1) === 2);
  check('image helper: ширина ограничена 10–100 %', imageUtils.clampImageWidth(4) === 10 && imageUtils.clampImageWidth(150) === 100);

  const marker = imageUtils.createImageMarker({ x: 120, y: -10, text: '  Серверная  ' });
  check(
    'image helper: маркер с координатами и текстом',
    marker.x === 100 && marker.y === 0 && marker.text === 'Серверная' && marker.field === 'marker',
    JSON.stringify(marker),
  );
  const withMarker = imageUtils.addImageMarker([], marker);
  check(
    'image helper: маркер добавляется и удаляется',
    withMarker.length === 1 && imageUtils.removeImageMarker(withMarker, marker.id).length === 0,
  );
  check('image helper: пустой текст удаляет маркер', imageUtils.setImageMarkerText(withMarker, marker.id, '   ').length === 0);
  check(
    'image helper: маркеры берутся из data.notes',
    imageUtils.collectImageMarkers({
      notes: [...withMarker, { id: 'caption-note', text: 'Подпись', field: 'caption' }],
    }).length === 1,
  );

  // Рамки выделения: фигуры, оформление и список
  const shape = imageUtils.createImageShape({ type: 'ellipse', x: 10, y: 15, w: 20, h: 30 });
  check(
    'image helper: новая рамка с фигурой и цветом',
    shape.type === 'ellipse' && shape.color === '#E03131' && shape.w === 20 && shape.fill === 0 && shape.stroke === 2,
    JSON.stringify(shape),
  );
  check('image helper: неизвестная фигура — прямоугольник', imageUtils.normalizeShape({ type: 'star' }).type === 'rect');
  check(
    'image helper: заливка 0–100 %, контур 0–4 px',
    imageUtils.normalizeShape({ fill: 150, stroke: 9 }).fill === 100 &&
      imageUtils.normalizeShape({ fill: 150, stroke: 9 }).stroke === 4 &&
      imageUtils.normalizeShape({ fill: -5, stroke: -1 }).fill === 0 &&
      imageUtils.normalizeShape({ fill: -5, stroke: -1 }).stroke === 0,
  );
  check(
    'image helper: поворот ограничен ±180°',
    imageUtils.normalizeShape({ rotation: -400 }).rotation === -180 &&
      imageUtils.normalizeShape({ rotation: 400 }).rotation === 180,
    String(imageUtils.normalizeShape({ rotation: 400 }).rotation),
  );
  check(
    'image helper: рамка не выходит за картинку',
    imageUtils.normalizeShape({ x: 90, y: 90, w: 30, h: 30 }).x === 70 &&
      imageUtils.normalizeShape({ x: 90, y: 90, w: 30, h: 30 }).y === 70,
  );
  const withShapes = imageUtils.addImageShape([], shape);
  check(
    'image helper: рамка добавляется, меняется и удаляется',
    withShapes.length === 1 &&
      imageUtils.updateImageShape(withShapes, shape.id, { color: '#2F71C8' })[0].color === '#2F71C8' &&
      imageUtils.removeImageShape(withShapes, shape.id).length === 0,
  );
  check(
    'image helper: название рамки — фигура и цвет',
    imageUtils.shapeTitle({ type: 'rect', color: '#E03131' }) === 'Прямоугольник (красный)',
    imageUtils.shapeTitle({ type: 'rect', color: '#E03131' }),
  );
  check(
    'image helper: цвет темы в названии рамки',
    imageUtils.shapeTitle({ type: 'arrow', color: '#8B2332' }, { themeColors: ['#8B2332'] }) ===
      'Стрелка (цвет темы 1)',
    imageUtils.shapeTitle({ type: 'arrow', color: '#8B2332' }, { themeColors: ['#8B2332'] }),
  );
  check(
    'image helper: рамка по двум точкам',
    JSON.stringify(imageUtils.rectFromPoints({ x: 80, y: 70 }, { x: 20, y: 10 })) ===
      JSON.stringify({ x: 20, y: 10, w: 60, h: 60 }),
    JSON.stringify(imageUtils.rectFromPoints({ x: 80, y: 70 }, { x: 20, y: 10 })),
  );
  check('image helper: без рамок список пустой', imageUtils.collectImageShapes({}).length === 0);
  check(
    'image helper: четыре фигуры и лимит 20',
    imageUtils.IMAGE_SHAPE_TYPES.join(',') === 'rect,ellipse,triangle,arrow' &&
      imageUtils.IMAGE_SHAPES_LIMIT === 20,
  );

  // Правка 10: без blockId (печать и статический просмотр) чек-лист
  // остаётся неинтерактивным и показывает авторскую отметку.
  const staticChecklistHtml = renderToStaticMarkup(
    React.createElement(ContentRenderer, {
      content: step10Contents.find((content) => content.id === 'content-checklist'),
    }),
  );
  check(
    'checklist (print): авторская отметка без чекбоксов',
    staticChecklistHtml.includes('✓') &&
      !staticChecklistHtml.includes('content-checklist--interactive') &&
      !staticChecklistHtml.includes('type="checkbox"'),
  );

  // Правка 8: код как в VS Code — тёмный фон, номера строк, безопасный вывод
  const { countCodeLines, codeGutter, safeCodeText } = await vite.ssrLoadModule('/src/utils/code.js');
  check('code (utils): пустой код — одна строка', countCodeLines('') === 1);
  check('code (utils): строки считаются по переводам', countCodeLines('a\nb\nc') === 3);
  check('code (utils): перевод в конце — ещё одна строка', countCodeLines('a\n') === 2);
  check('code (utils): жёлоб с номерами строк', codeGutter('a\nb\nc') === '1\n2\n3');
  check('code (utils): NUL заменён без сдвига позиций', safeCodeText('a\u0000b').length === 3 && safeCodeText('a\u0000b') === 'a b');
  check('code (utils): не-строка становится пустой', safeCodeText(null) === '' && safeCodeText(42) === '42');

  const codeLines = 'const a = 1;\nconst b = 2;\n';
  const codeContent = {
    id: 'content-code-lines',
    type: 'code',
    width: 100,
    data: {
      language: 'javascript',
      filename: 'app.js',
      code: codeLines,
      notes: [{ id: 'note-c1', text: 'Первая строка', field: 'code', from: 0, to: 5, word: 'const' }],
      links: [
        { id: 'link-c1', kind: 'external', field: 'code', from: 6, to: 7, word: 'a', href: 'https://example.com', newTab: true },
      ],
    },
  };
  const codeViewHtml = renderToStaticMarkup(React.createElement(ContentRenderer, { content: codeContent, noteOffset: 0 }));
  check(
    'code (view): тёмная панель и номера строк',
    codeViewHtml.includes('code-surface--view') &&
      codeViewHtml.includes('code-surface__gutter') &&
      codeViewHtml.includes('>1\n2\n3<'),
  );
  check('code (view): жёлоб скрыт от скринридера', codeViewHtml.includes('aria-hidden="true"'));
  check('code (view): код без подложки общей плашки', codeViewHtml.includes('content-code-wrap'));
  check(
    'code (view): примечание и ссылка внутри кода',
    codeViewHtml.includes('data-note-id="note-c1"') && codeViewHtml.includes('content-link--external'),
  );

  const evilCode = '<script>alert("x")</script>\n</code><img src=x onerror=alert(1)>';
  const evilHtml = renderToStaticMarkup(
    React.createElement(ContentRenderer, {
      content: { id: 'content-code-evil', type: 'code', data: { language: 'html', code: evilCode } },
    }),
  );
  check('code (safety): <script> остался текстом', evilHtml.includes('&lt;script&gt;alert') && !evilHtml.includes('<script>'));
  check('code (safety): </code> не обрывает разметку', evilHtml.includes('&lt;/code&gt;&lt;img') && !evilHtml.includes('</code><img'));
  check('code (safety): кавычки экранированы', evilHtml.includes('&quot;x&quot;'));
  check('code (safety): тег img из кода не создан', !evilHtml.includes('<img'));

  const emptyCodeHtml = renderToStaticMarkup(
    React.createElement(ContentRenderer, { content: { id: 'content-code-empty', type: 'code', data: { code: '' } } }),
  );
  check('code (view): пустой код — подсказка и одна строка', emptyCodeHtml.includes('// код пока не добавлен') && emptyCodeHtml.includes('>1<'));

  const { default: CodeEditor } = await vite.ssrLoadModule('/src/components/content/editors/CodeEditor.jsx');
  const codeEditorHtml = renderToStaticMarkup(
    React.createElement(CodeEditor, {
      content: { id: 'content-code-editor', type: 'code', data: { language: 'javascript', filename: 'app.js', code: codeLines } },
      onChange: () => {},
    }),
  );
  check(
    'code (edit): тёмная панель с номерами строк',
    codeEditorHtml.includes('code-surface--editor') && codeEditorHtml.includes('>1\n2\n3<'),
  );
  check('code (edit): перенос строк отключён, Tab не уводит фокус', codeEditorHtml.includes('wrap="off"'));
  check('code (edit): подсказка о числе строк', codeEditorHtml.includes('Строк: 3'));

  const codeSecuritySources = await Promise.all(
    ['CodeSurface.jsx', 'ContentRenderer.jsx', 'editors/CodeEditor.jsx'].map((file) =>
      readFile(fileURLToPath(new URL(`../src/components/content/${file}`, import.meta.url)), 'utf8'),
    ),
  );
  check(
    'code (safety): нет dangerouslySetInnerHTML',
    codeSecuritySources.every((source) => !source.includes('dangerouslySetInnerHTML')),
  );
  check(
    'code (safety): код не исполняется через eval',
    codeSecuritySources.every((source) => !/\beval\s*\(/.test(source) && !source.includes('new Function')),
  );

  const printCss = await readFile(fileURLToPath(new URL('../src/styles/print.css', import.meta.url)), 'utf8');
  check(
    'code (css): тёмный фон VS Code',
    globalsCss.includes('.code-surface {') &&
      globalsCss.includes('--code-bg: #1e1e1e;') &&
      globalsCss.includes('--code-bg-gutter: #252526;'),
  );
  check(
    'code (css): жёлоб и полотно объявлены',
    globalsCss.includes('.code-surface__gutter') && globalsCss.includes('.code-surface .code-editor'),
  );
  check(
    'code (css): печать — светлый фон без номеров',
    printCss.includes('.print-doc .code-surface__gutter') && printCss.includes('background: #fff;'),
  );

  // Диалог в PDF: реплика не рвётся между страницами, облако печатается со своим
  // фоном и рамкой, аватар ужимается (на экране размер задаёт автор).
  const dialogPrintAt = printCss.indexOf('.print-doc .content-dialog__item');
  const dialogPrintBlock =
    dialogPrintAt === -1 ? '' : printCss.slice(dialogPrintAt, printCss.indexOf('}', dialogPrintAt));
  check(
    'dialog (css): печать — реплика не рвётся между страницами',
    dialogPrintBlock.includes('break-inside: avoid'),
  );
  check(
    'dialog (css): печать — облако с фоном и аватаром',
    printCss.includes('.print-doc .content-dialog__avatar') &&
      printCss.includes('.print-doc .content-dialog__bubble') &&
      printCss.includes('print-color-adjust: exact;'),
  );
  const { default: TestBlock } = await vite.ssrLoadModule('/src/components/editor/TestBlock.jsx');
  const { default: MemoBlock } = await vite.ssrLoadModule('/src/components/editor/MemoBlock.jsx');
  const { default: GlossaryBlock } = await vite.ssrLoadModule('/src/components/editor/GlossaryBlock.jsx');
  const { useTestStore } = await vite.ssrLoadModule('/src/store/testStore.js');
  const { useMemoStore } = await vite.ssrLoadModule('/src/store/memoStore.js');
  const { useGlossaryStore } = await vite.ssrLoadModule('/src/store/glossaryStore.js');
  const { parseCsv, csvToQuestions, csvToTerms } = await vite.ssrLoadModule('/src/utils/csv.js');
  const { toDraft, validateDraft, createQuestionPayload } = await vite.ssrLoadModule('/src/utils/testDraft.js');
  const { buildEditorRows, optionTargetValue, parseTargetValue, dragReorder, sanitizeTargets } =
    await vite.ssrLoadModule('/src/utils/testEditor.js');
  const { sortTerms, CONTENT_TYPES } = await vite.ssrLoadModule('/src/utils/helpers.js');
  const { contentBodyContents, contentBodyToText, normalizeContentBody } = await vite.ssrLoadModule(
    '/src/utils/contentBody.js',
  );

  const csvSample = parseCsv('вопрос;вариант 1;вариант 2;номер\n"Что такое СИЗ?";"Средства; защиты";Шарф;1');
  check(
    'csv: кавычки, точка с запятой и заголовок',
    csvSample.delimiter === ';' && csvSample.rows.length === 2 && csvSample.rows[1][1] === 'Средства; защиты',
  );

  const csvQuestions = csvToQuestions(csvSample.rows);
  check(
    'csv: вопрос с одним верным',
    csvQuestions.items.length === 1 &&
      csvQuestions.items[0].type === 'single' &&
      csvQuestions.items[0].options[0].isCorrect &&
      csvQuestions.items[0].line === 2,
  );

  const csvMultiple = csvToQuestions(parseCsv('Какой ответ?;А;Б;В;1,3;Пояснение').rows);
  check(
    'csv: несколько верных и пояснение',
    csvMultiple.items[0]?.type === 'multiple' &&
      csvMultiple.items[0].options.filter((option) => option.isCorrect).length === 2 &&
      csvMultiple.items[0].explanation?.type === 'doc',
  );

  const csvBroken = csvToQuestions(parseCsv('Какой ответ?;Один;2').rows);
  check('csv: строка с ошибкой', csvBroken.items.length === 0 && csvBroken.errors.length === 1, csvBroken.errors);

  const csvTermRows = csvToTerms(parseCsv('Термин;Определение\nСИЗ;Средства защиты').rows);
  check('csv: термины с заголовком', csvTermRows.items.length === 1 && csvTermRows.items[0].term === 'СИЗ');

  const draftWithoutCorrect = toDraft({
    type: 'single',
    data: { text: 'Вопрос' },
    options: [
      { text: 'А', isCorrect: false },
      { text: 'Б', isCorrect: false },
    ],
  });
  check('draft: single без верного невалиден', validateDraft(draftWithoutCorrect).ok === false);

  const draftValid = toDraft({
    type: 'multiple',
    data: { text: 'Вопрос' },
    options: [
      { text: 'А', isCorrect: true },
      { text: 'Б', isCorrect: false },
    ],
  });
  check('draft: multiple с верным валиден', validateDraft(draftValid).ok === true);
  check(
    'draft: новый вопрос получает валидные заглушки',
    validateDraft(toDraft(createQuestionPayload('single', 'Текст', null))).ok === true,
  );

  check(
    'terms: сортировка по алфавиту',
    sortTerms([{ term: 'Яблоко' }, { term: 'арбуз' }, { term: 'Ёж' }])
      .map((term) => term.term)
      .join(',') === 'арбуз,Ёж,Яблоко',
  );

  const testBlockData = {
    id: 'block-test',
    courseId: 'course-1',
    course: { id: 'course-1', title: 'Охрана труда' },
    type: 'test',
    title: 'Итоговый тест',
    description: '',
    contentCount: 4,
  };

  const sampleQuestions = [
    {
      id: 'q-1',
      blockId: 'block-test',
      groupId: 'g-1',
      sectionId: 's-1',
      type: 'single',
      data: { text: 'Что такое СИЗ?' },
      explanation: null,
      order: 0,
      group: { id: 'g-1', name: 'Основы' },
      section: { id: 's-1', title: 'Основы охраны труда' },
      options: [
        { id: 'o-1', text: 'Средства защиты', isCorrect: true, order: 0, targetType: 'next', targetSectionId: null },
        {
          id: 'o-2',
          text: 'Служба знаний',
          isCorrect: false,
          order: 1,
          targetType: 'section',
          targetSectionId: 's-1',
        },
      ],
      pairs: [],
    },
    {
      id: 'q-2',
      blockId: 'block-test',
      groupId: null,
      type: 'multiple',
      data: { text: 'Какие СИЗ обязательны?' },
      explanation: docWith('Смотри инструкцию.'),
      order: 1,
      group: null,
      options: [
        { id: 'o-3', text: 'Каска', isCorrect: true, order: 0 },
        { id: 'o-4', text: 'Перчатки', isCorrect: true, order: 1 },
        { id: 'o-5', text: 'Шарф', isCorrect: false, order: 2 },
      ],
      pairs: [],
    },
    {
      id: 'q-3',
      blockId: 'block-test',
      groupId: 'g-1',
      type: 'match',
      data: { text: 'Сопоставьте понятия' },
      explanation: null,
      order: 2,
      group: { id: 'g-1', name: 'Основы' },
      options: [],
      pairs: [
        { id: 'p-1', left: 'Каска', right: 'Головной убор', order: 0 },
        { id: 'p-2', left: 'Респиратор', right: 'Защита дыхания', order: 1 },
      ],
    },
    {
      id: 'q-4',
      blockId: 'block-test',
      groupId: null,
      type: 'card',
      data: { front: 'СИЗ', back: 'Средства индивидуальной защиты' },
      explanation: null,
      order: 3,
      group: null,
      options: [],
      pairs: [],
    },
  ];

  seed(useTestStore, {
    blockId: 'block-test',
    groups: [{ id: 'g-1', name: 'Основы', order: 0 }],
    sections: [{ id: 's-1', title: 'Основы охраны труда', result: null, order: 0, questionsCount: 1 }],
    settings: { shuffleQuestions: true, shuffleOptions: false, branching: true, result: null },
    questions: sampleQuestions,
    loading: false,
    loaded: true,
    error: null,
  });
  seed(useUiStore, { uiMode: 'edit', modal: null });

  // Редактор запоминает выбранный вопрос: подставляем активную карточку,
  // чтобы отрисовалась правая панель настроек.
  memory.set('course-builder:test-editor:block-test', JSON.stringify({ activeId: 'q-1' }));

  const testEdit = render(TestBlock, '/block/block-test', { block: testBlockData });
  memory.delete('course-builder:test-editor:block-test');

  check(
    'test (edit): панель базовых настроек с тумблерами',
    testEdit.includes('test-settings') &&
      testEdit.includes('Перемешивать вопросы') &&
      testEdit.includes('Перемешивать варианты') &&
      testEdit.includes('Режим ветвления'),
  );
  check(
    'test (edit): группы в настройках теста',
    testEdit.includes('test-groups') && testEdit.includes('Основы') && testEdit.includes('Новая группа'),
  );
  check('test (edit): четыре карточки вопросов', (testEdit.match(/class="question-card[ "]/g) ?? []).length === 4);
  check(
    'test (edit): активная карточка подсвечена',
    testEdit.includes('question-card is-active') && testEdit.includes('is-active'),
  );
  check(
    'test (edit): правая панель настроек вопроса',
    testEdit.includes('question-settings') &&
      testEdit.includes('Настройки вопроса') &&
      testEdit.includes('Дублировать') &&
      testEdit.includes('Удалить'),
  );
  check(
    'test (edit): карточка перетаскивается целиком, без ручки',
    !testEdit.includes('question-card__grip') &&
      /data-question-id="[^"]+"[^>]*draggable="true"/.test(testEdit),
  );
  check(
    'test (edit): настройки вопроса открывает шестерёнка',
    (testEdit.match(/data-settings-toggle/g) ?? []).length === 4 &&
      testEdit.includes('aria-expanded="true"') &&
      testEdit.includes('aria-expanded="false"'),
  );
  check(
    'test (edit): логика перехода по вариантам',
    testEdit.includes('Логика перехода') &&
      testEdit.includes('Перейти к следующему вопросу') &&
      testEdit.includes('Перейти к разделу «Основы охраны труда»') &&
      testEdit.includes('value="section:s-1"'),
  );
  check(
    'test (edit): раздел ветвления между вопросами',
    testEdit.includes('test-section-card') &&
      testEdit.includes('Итоговый комментарий этого пути') &&
      testEdit.includes('Добавить раздел'),
  );
  check('test (edit): варианты с отметкой верного', testEdit.includes('type="radio"') && testEdit.includes('Средства защиты'));
  check('test (edit): лимит вариантов и счётчик', testEdit.includes('Добавить вариант') && testEdit.includes('из 12'));
  check(
    'test (edit): пары сопоставления с перетаскиванием',
    testEdit.includes('pair-row__grip') && testEdit.includes('Головной убор') && testEdit.includes('Добавить пару'),
  );
  check(
    'test (edit): обе стороны карточки с картинками',
    testEdit.includes('Передняя сторона') &&
      testEdit.includes('Задняя сторона') &&
      testEdit.includes('Средства индивидуальной защиты') &&
      (testEdit.match(/type="file"/g) ?? []).length >= 2,
  );
  check(
    'test (edit): пояснение на розовом фоне',
    testEdit.includes('question-card__explanation') && testEdit.includes('Объяснение'),
  );
  check(
    'test (edit): форма нового вопроса в конце списка',
    testEdit.includes('question-new') && testEdit.includes('Добавить вопрос'),
  );
  check('test (edit): импорт и экспорт CSV', testEdit.includes('Импорт CSV') && testEdit.includes('Экспорт CSV'));
  check(
    'test (edit): панель инструментов у пояснений',
    testEdit.includes('role="toolbar"') && testEdit.includes('Жирный') && !testEdit.includes('Добавить контент'),
  );
  check(
    'test (edit): нет фильтра групп читателя',
    !testEdit.includes('group-item__count') && !testEdit.includes('Все вопросы') && !testEdit.includes('test-layout'),
  );

  seed(useUiStore, { uiMode: 'view' });
  const testView = render(TestBlock, '/block/block-test', { block: testBlockData });
  check(
    'test (view): один вопрос, шапка с таймером и прогрессом',
    (testView.match(/class="test-question"/g) ?? []).length === 1 &&
      testView.includes('test-run__head') &&
      testView.includes('test-run__timer') &&
      testView.includes('00:00') &&
      testView.includes('Вопрос 1 из 4') &&
      testView.includes('Отвечено 0 из 4'),
  );
  check(
    'test (view): полоса прогресса и кнопка паузы',
    testView.includes('test-run__progress') &&
      testView.includes('role="progressbar"') &&
      testView.includes('aria-valuenow="0"') &&
      testView.includes('>Пауза<'),
  );
  check(
    'test (view): сетка навигации из четырёх вопросов',
    (testView.match(/class="test-nav__btn/g) ?? []).length === 4 &&
      testView.includes('test-nav__btn is-empty is-current') &&
      testView.includes('aria-current="step"'),
  );
  check(
    'test (view): подвал и завершение теста, легенды нет',
    testView.includes('test-run__footer') &&
      testView.includes('>Назад<') &&
      // Порядок вопросов в попытке перемешан, поэтому подсказка зависит от типа.
      (/Выберите вариант и нажмите «Готово»|Нажмите «Знаю» или «Не знаю»/.test(testView)) &&
      /disabled[^>]*>\s*Дальше/.test(testView) &&
      testView.includes('Завершить тест') &&
      !testView.includes('test-run__legend') &&
      !testView.includes('test-run__dot'),
  );
  check('test (view): редакторов нет', !testView.includes('question-new') && !testView.includes('Добавить вопрос'));
  check(
    'test (view): старого списка вопросов нет',
    !testView.includes('question-view__option') && !testView.includes('question-view__pairs'),
  );
  check('test (view): панели инструментов нет', !testView.includes('role="toolbar"'));
  check(
    'test (view): нет панелей и карточек редактора',
    !testView.includes('test-settings') &&
      !testView.includes('question-card') &&
      !testView.includes('question-settings') &&
      !testView.includes('Добавить раздел'),
  );

  // Режим читателя: типы вопросов, экран итогов и сверка сохранённой попытки.
  const { default: ReaderQuestion } = await vite.ssrLoadModule('/src/components/test/ReaderQuestion.jsx');
  const { default: ReaderResults } = await vite.ssrLoadModule('/src/components/test/ReaderResults.jsx');
  const testRunUtils = await vite.ssrLoadModule('/src/utils/testRun.js');
  const testNoop = () => {};

  const singleHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[0],
    index: 0,
    total: 2,
    answer: null,
    draft: null,
    optionOrder: ['o-2', 'o-1'],
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): один ответ — радио, порядок из попытки и неактивное «Готово»',
    singleHtml.indexOf('Служба знаний') < singleHtml.indexOf('Средства защиты') &&
      singleHtml.includes('test-option__mark--radio') &&
      (singleHtml.match(/class="test-option[ "]/g) ?? []).length === 2 &&
      singleHtml.includes('test-question__submit') &&
      /disabled=""[^>]*>\s*Готово/.test(singleHtml) &&
      !singleHtml.includes('test-feedback'),
  );

  // Выбор до «Готово» — черновик: ни подсветки верного, ни плашки с вердиктом,
  // ни блокировки вариантов. Кнопка «Готово» при этом активна.
  const pickedHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[0],
    index: 0,
    total: 2,
    answer: null,
    draft: { selected: ['o-1'] },
    optionOrder: ['o-1', 'o-2'],
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): выбор не проверяется и меняется до «Готово»',
    pickedHtml.includes('test-option is-picked') &&
      !pickedHtml.includes('is-correct') &&
      !pickedHtml.includes('is-wrong') &&
      !pickedHtml.includes('test-feedback') &&
      !pickedHtml.includes('test-question__verdict') &&
      pickedHtml.includes('Выбор можно менять до нажатия «Готово»') &&
      !/disabled=""[^>]*>\s*Готово/.test(pickedHtml),
  );

  const resolvedHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[0],
    index: 0,
    total: 2,
    answer: { selected: ['o-1'], verdict: 'correct' },
    optionOrder: ['o-1', 'o-2'],
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): после «Готово» верный вариант подсвечен, кнопки нет',
    resolvedHtml.includes('test-option is-picked is-correct') &&
      resolvedHtml.includes('test-feedback is-correct') &&
      resolvedHtml.includes('Верно!') &&
      !resolvedHtml.includes('test-question__submit'),
  );

  const multipleHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[1],
    index: 1,
    total: 2,
    answer: null,
    draft: { selected: ['o-3'] },
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): несколько ответов — чекбоксы и «Готово» вместо «Ответить»',
    multipleHtml.includes('test-option__mark--checkbox') &&
      multipleHtml.includes('test-question__submit') &&
      multipleHtml.includes('Готово') &&
      !multipleHtml.includes('Ответить') &&
      !multipleHtml.includes('is-correct'),
  );

  const matchHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[2],
    index: 2,
    total: 2,
    answer: null,
    draft: null,
    pairOrder: ['p-2', 'p-1'],
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): сопоставление — счётчик, подсказка и неактивное «Готово»',
    matchHtml.includes('test-match') &&
      matchHtml.includes('Соединено 0 из 2') &&
      matchHtml.includes('Нажмите понятие слева') &&
      matchHtml.includes('Соедините все пары и нажмите «Готово»') &&
      /disabled=""[^>]*>\s*Готово/.test(matchHtml),
  );

  // Все пары соединены, но ответа ещё нет: оценка не выносится, пары можно менять.
  const matchDraftHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[2],
    index: 2,
    total: 2,
    answer: null,
    draft: { matches: { 'p-1': 'p-2', 'p-2': 'p-1' } },
    pairOrder: ['p-2', 'p-1'],
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): сопоставление не проверяется до «Готово»',
    matchDraftHtml.includes('Соединено 2 из 2') &&
      matchDraftHtml.includes('Пары можно менять до нажатия «Готово»') &&
      !matchDraftHtml.includes('test-feedback') &&
      !matchDraftHtml.includes('is-wrong') &&
      !/disabled=""[^>]*>\s*Готово/.test(matchDraftHtml),
  );

  const cardHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[3],
    index: 3,
    total: 4,
    answer: null,
    onSubmit: testNoop,
  });
  check(
    'test (reader): карточка — две стороны, «Знаю / Не знаю» без «Готово»',
    cardHtml.includes('test-flashcard__face--back') &&
      cardHtml.includes('Средства индивидуальной защиты') &&
      cardHtml.includes('Не знаю') &&
      cardHtml.includes('Знаю') &&
      !cardHtml.includes('test-question__submit'),
  );

  // Режим ветвления: верных и неверных ответов нет, оценки тоже.
  const { default: ReaderNavigation } = await vite.ssrLoadModule('/src/components/test/ReaderNavigation.jsx');

  const branchNavHtml = render(ReaderNavigation, '/block/block-test', {
    questions: sampleQuestions,
    currentId: 'q-2',
    answers: { 'q-1': { selected: ['o-2'], verdict: 'answered' } },
    graded: false,
    onSelect: testNoop,
  });
  check(
    'test (reader): при ветвлении навигация красит только отвеченные',
    branchNavHtml.includes('test-nav__btn is-answered') &&
      !branchNavHtml.includes('is-correct') &&
      !branchNavHtml.includes('is-wrong') &&
      branchNavHtml.includes('Вопрос 1: отвечен') &&
      branchNavHtml.includes('Вопрос 2: без ответа'),
  );

  const branchSingleHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[0],
    index: 0,
    total: 2,
    answer: { selected: ['o-2'], verdict: 'answered' },
    optionOrder: ['o-2', 'o-1'],
    graded: false,
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): при ветвлении нет вердикта и подсветки верного',
    branchSingleHtml.includes('test-option is-picked') &&
      !branchSingleHtml.includes('test-option is-correct') &&
      !branchSingleHtml.includes('test-option is-wrong') &&
      !branchSingleHtml.includes('test-question__verdict') &&
      !branchSingleHtml.includes('test-feedback') &&
      !branchSingleHtml.includes('test-question__submit') &&
      !branchSingleHtml.includes('Верно'),
  );

  const branchMultipleHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[1],
    index: 1,
    total: 2,
    answer: null,
    draft: { selected: ['o-3'] },
    graded: false,
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): при ветвлении ответ отправляется кнопкой «Готово»',
    branchMultipleHtml.includes('test-question__submit') &&
      branchMultipleHtml.includes('Кнопка «Готово» зафиксирует выбор') &&
      !branchMultipleHtml.includes('засчитает ошибку'),
  );

  const branchFeedbackHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[1],
    index: 1,
    total: 2,
    answer: { selected: ['o-3'], verdict: 'answered' },
    graded: false,
    onSubmit: testNoop,
    onDraft: testNoop,
  });
  check(
    'test (reader): при ветвлении остаётся только пояснение автора',
    branchFeedbackHtml.includes('test-feedback is-plain') &&
      branchFeedbackHtml.includes('Смотри инструкцию.') &&
      !branchFeedbackHtml.includes('test-feedback is-correct') &&
      !branchFeedbackHtml.includes('Правильный ответ'),
  );

  const branchCardHtml = render(ReaderQuestion, '/block/block-test', {
    question: sampleQuestions[3],
    index: 3,
    total: 4,
    answer: { know: true, verdict: 'answered' },
    graded: false,
    onSubmit: testNoop,
  });
  check(
    'test (reader): при ветвлении карточка не выносит вердикт',
    branchCardHtml.includes('test-flashcard is-flipped') &&
      branchCardHtml.includes('is-yes is-active') &&
      !branchCardHtml.includes('test-flashcard__verdict'),
  );

  const resultsRun = {
    blockId: 'block-test',
    sequence: ['q-1', 'q-2', 'q-3', 'q-4'],
    answers: {
      'q-1': { selected: ['o-1'], verdict: 'correct' },
      'q-2': { selected: ['o-3'], verdict: 'wrong' },
    },
    picks: {},
    optionOrder: {},
    pairOrder: {},
    elapsed: 75,
    running: false,
    runningSince: null,
    finished: true,
    finishedAt: Date.now(),
  };
  const resultsData = testRunUtils.computeResults({
    questions: sampleQuestions,
    run: resultsRun,
    sections: [{ id: 's-1', title: 'Основы охраны труда', result: null, order: 0 }],
    settings: { shuffleQuestions: false, shuffleOptions: false, branching: false, result: docWith('Общий итог') },
  });
  const resultsHtml = render(ReaderResults, '/block/block-test', {
    block: testBlockData,
    results: resultsData,
    nextBlock: null,
    onRestart: testNoop,
  });
  check(
    'test (results): процент по отвеченным и время',
    resultsData.graded === true &&
      resultsData.percent === 50 &&
      resultsData.answered === 2 &&
      resultsData.total === 4 &&
      resultsHtml.includes('test-results__score is-mid') &&
      resultsHtml.includes('50%') &&
      resultsHtml.includes('01:15'),
  );
  check(
    'test (results): разбор ответов и итоговый комментарий',
    resultsHtml.includes('test-results__details') &&
      resultsHtml.includes('Разбор ответов') &&
      resultsHtml.includes('Без ответа') &&
      resultsHtml.includes('test-results__comment') &&
      resultsHtml.includes('Общий итог'),
  );

  // Итоги режима ветвления: оценки нет, правильные ответы не раскрываются.
  const branchResults = testRunUtils.computeResults({
    questions: sampleQuestions,
    run: {
      ...resultsRun,
      answers: {
        'q-1': { selected: ['o-2'], verdict: 'answered' },
        'q-2': { selected: ['o-3'], verdict: 'answered' },
        'q-3': { matches: { 'p-1': 'p-2', 'p-2': 'p-1' }, verdict: 'answered' },
      },
    },
    sections: [{ id: 's-1', title: 'Основы охраны труда', result: null, order: 0 }],
    settings: { shuffleQuestions: false, shuffleOptions: false, branching: true, result: docWith('Итог пути') },
  });
  const branchResultsHtml = render(ReaderResults, '/block/block-test', {
    block: testBlockData,
    results: branchResults,
    nextBlock: null,
    onRestart: testNoop,
  });
  check(
    'test (results): при ветвлении оценки нет, но ответы видны',
    branchResults.graded === false &&
      branchResults.percent === null &&
      branchResults.correct === null &&
      branchResults.wrong === null &&
      branchResults.answered === 3 &&
      branchResults.details[0].verdict === 'answered' &&
      branchResults.details[0].correct === null &&
      branchResults.groups[0].percent === null,
  );
  check(
    'test (results): при ветвлении нет процента и правильных ответов',
    branchResultsHtml.includes('test-results__score is-neutral') &&
      branchResultsHtml.includes('3/4') &&
      branchResultsHtml.includes('Оценка не выставляется') &&
      branchResultsHtml.includes('Отвечено 3 из 4') &&
      !branchResultsHtml.includes('Правильный ответ') &&
      !branchResultsHtml.includes('test-results__bar') &&
      !branchResultsHtml.includes('%'),
  );
  check(
    'test (results): при ветвлении комментарий пути сохраняется',
    branchResultsHtml.includes('test-results__comment') && branchResultsHtml.includes('Итог пути'),
  );

  const reconciled = testRunUtils.reconcileRun(
    {
      blockId: 'block-test',
      sequence: ['q-gone', 'q-2'],
      currentId: 'q-gone',
      answers: { 'q-gone': { verdict: 'correct' }, 'q-2': { verdict: 'wrong' } },
      picks: { 'q-gone': { selected: [] } },
      optionOrder: { 'q-1': ['o-2'], 'q-gone': ['x'] },
      pairOrder: { 'q-3': ['p-2'] },
    },
    sampleQuestions,
    { shuffleQuestions: true, shuffleOptions: true },
  );
  check(
    'test (utils): сверка попытки убирает удалённый вопрос и дополняет порядок',
    reconciled.sequence.join(',') === 'q-2,q-1,q-3,q-4' &&
      reconciled.currentId === 'q-2' &&
      reconciled.answers['q-gone'] === undefined &&
      reconciled.picks['q-gone'] === undefined &&
      reconciled.optionOrder['q-1'].join(',') === 'o-2,o-1' &&
      reconciled.optionOrder['q-gone'] === undefined &&
      reconciled.pairOrder['q-3'].join(',') === 'p-2,p-1',
  );
  check(
    'test (utils): прогресс считает только проверенные ответы',
    testRunUtils.runProgress({ sequence: ['q-1', 'q-2'], answers: { 'q-1': { verdict: 'correct' } } }).percent === 50,
  );
  check(
    'test (utils): ветвление выключает оценку, но не прогресс',
    !testRunUtils.isGraded({ branching: true }) &&
      testRunUtils.isGraded({ branching: false }) &&
      testRunUtils.isResolved({ verdict: 'answered' }) &&
      testRunUtils.runProgress({ sequence: ['q-1', 'q-2'], answers: { 'q-1': { verdict: 'answered' } } }).percent === 50 &&
      testRunUtils.matchProgress(sampleQuestions[2], { 'p-1': 'p-2' }).matched === 1,
  );
  check(
    'test (utils): «Готово» активно после выбора и проверяет ответ',
    !testRunUtils.canSubmit(sampleQuestions[0], { selected: [] }) &&
      testRunUtils.canSubmit(sampleQuestions[0], { selected: ['o-2'] }) &&
      !testRunUtils.canSubmit(sampleQuestions[2], { matches: { 'p-1': 'p-1' } }) &&
      testRunUtils.canSubmit(sampleQuestions[2], { matches: { 'p-1': 'p-1', 'p-2': 'p-2' } }) &&
      testRunUtils.canSubmit(sampleQuestions[3], { know: true }) &&
      testRunUtils.gradeAnswer(sampleQuestions[0], { selected: ['o-1'] }).verdict === 'correct' &&
      testRunUtils.gradeAnswer(sampleQuestions[0], { selected: ['o-2'] }).verdict === 'wrong' &&
      testRunUtils.gradeAnswer(sampleQuestions[0], { selected: ['o-2'] }, false).verdict === 'answered' &&
      testRunUtils.gradeAnswer(sampleQuestions[1], { selected: ['o-3'] }).verdict === 'wrong' &&
      testRunUtils.gradeAnswer(sampleQuestions[1], { selected: ['o-3', 'o-4'] }).verdict === 'correct' &&
      testRunUtils.gradeAnswer(sampleQuestions[3], { know: true }).verdict === 'correct',
  );
  check(
    'test (utils): ветвление ведёт в раздел, без ветвления — дальше',
    testRunUtils.nextQuestionId({
      sequence: ['q-1', 'q-2'],
      currentId: 'q-1',
      questions: sampleQuestions,
      answer: { selected: ['o-2'] },
      settings: { branching: true },
    }) === 'q-1' &&
      testRunUtils.nextQuestionId({
        sequence: ['q-1', 'q-2'],
        currentId: 'q-1',
        questions: sampleQuestions,
        answer: { selected: ['o-2'] },
        settings: { branching: false },
      }) === 'q-2',
  );

  // Логика режима редактора: раскладка разделов, перетаскивание и переходы.
  check(
    'editor (utils): перетаскивание переносит вопрос',
    dragReorder(['a', 'b', 'c'], 'c', 'a')?.join('') === 'cab',
  );
  check('editor (utils): перетаскивание на себя — без изменений', dragReorder(['a', 'b'], 'a', 'a') === null);
  check(
    'editor (utils): значение цели перехода',
    optionTargetValue({ targetType: 'section', targetSectionId: 's-1' }) === 'section:s-1' &&
      optionTargetValue({ targetType: 'submit' }) === 'submit' &&
      optionTargetValue({}) === 'next',
  );
  check(
    'editor (utils): разбор цели перехода',
    parseTargetValue('submit').targetType === 'submit' &&
      parseTargetValue('section:s-1').targetSectionId === 's-1' &&
      parseTargetValue('section:').targetType === 'next',
  );
  check(
    'editor (utils): удалённый раздел превращается в «следующий вопрос»',
    sanitizeTargets(
      [
        { text: 'A', targetType: 'section', targetSectionId: 'gone' },
        { text: 'B', targetType: 'submit', targetSectionId: null },
      ],
      [],
    )
      .map((option) => option.targetType)
      .join(',') === 'next,submit',
  );

  const editorRows = buildEditorRows(
    [
      { id: 'r-1', order: 0, sectionId: 'sec-1' },
      { id: 'r-2', order: 1, sectionId: null },
    ],
    [
      { id: 'sec-1', order: 0, title: 'Раздел' },
      { id: 'sec-2', order: 1, title: 'Пустой' },
    ],
  );
  check(
    'editor (utils): раздел стоит перед своим вопросом, пустой — в конце',
    editorRows.map((row) => row.kind).join(',') === 'section,question,question,section' &&
      editorRows[0].section.id === 'sec-1' &&
      editorRows[3].section.id === 'sec-2',
  );

  check(
    'test (css): панель настроек вопроса закреплена справа',
    globalsCss.includes('.question-settings {') && globalsCss.includes('position: fixed;'),
  );
  check(
    'test (css): розовое пояснение и активная карточка',
    globalsCss.includes('#f472b6 12%') && globalsCss.includes('.question-card.is-active'),
  );
  check(
    'test (css): карточка тянется целиком, ручки нет',
    !globalsCss.includes('.question-card__grip') &&
      globalsCss.includes('.question-card__head {') &&
      globalsCss.includes('.question-card__settings.is-active'),
  );
  check(
    'test (css): тумблеры и панель базовых настроек',
    globalsCss.includes('.switch__track') && globalsCss.includes('.test-settings__body'),
  );

  // Недоступность API: сеть, шлюз или перезапуск сервера. Раньше в алерте был
  // сырой текст axios («Request failed with status code 502»), теперь —
  // понятное сообщение, спокойная плашка и кнопка «Повторить».
  const { default: apiClient, getErrorMessage, isTransientError, errorKindOf } =
    await vite.ssrLoadModule('/src/api/axios.js');

  const axiosError = (status) => ({
    message: `Request failed with status code ${status}`,
    response: { status, data: {}, headers: {}, config: {} },
  });

  const unavailableText = 'Сервер временно недоступен. Попробуйте ещё раз через несколько секунд.';
  check(
    'api: 502/503/504 переведены в понятное сообщение',
    [502, 503, 504].every((status) => getErrorMessage(axiosError(status)) === unavailableText),
  );
  check(
    'api: технический текст axios не попадает в интерфейс',
    ![500, 502, 503, 504, 429].some((status) => /Request failed with status code/.test(getErrorMessage(axiosError(status)))),
  );
  check(
    'api: таймаут и обрыв связи объяснены пользователю',
    getErrorMessage(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' })).includes(
      'не ответил вовремя',
    ) && getErrorMessage(new Error('Network Error')).includes('Нет связи с сервером'),
  );
  check(
    'api: ошибки валидации остаются как есть',
    getErrorMessage({
      response: { status: 400, data: { message: 'Ошибка валидации', errors: { name: 'Название: обязательное поле' } } },
    }) === 'Название: обязательное поле',
  );
  check(
    'api: временные ошибки отделены от ответов 4xx',
    isTransientError(axiosError(502)) &&
      isTransientError(axiosError(503)) &&
      isTransientError({ code: 'ECONNABORTED' }) &&
      !isTransientError(axiosError(404)) &&
      !isTransientError(axiosError(403)),
  );
  check(
    'api: характер ошибки для плашки',
    errorKindOf({ code: 'ECONNABORTED' }) === 'offline' &&
      errorKindOf(axiosError(503)) === 'server' &&
      errorKindOf(axiosError(404)) === 'request',
  );

  // Автоповтор GET: шлюз мог не застать API сразу после перезапуска.
  const apiAdapter = apiClient.defaults.adapter;
  let retryAttempts = 0;
  apiClient.defaults.adapter = async (config) => {
    retryAttempts += 1;
    if (retryAttempts === 1) {
      const error = new Error('Request failed with status code 503');
      error.config = config;
      error.response = { status: 503, data: {}, headers: {}, config };
      throw error;
    }
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  };
  const retried = await apiClient.get('/retry-probe').then(
    (response) => ({ ok: true, data: response.data }),
    (error) => ({ ok: false, error }),
  );
  apiClient.defaults.adapter = apiAdapter;
  check(
    'api: GET повторяется после 503',
    retryAttempts === 2 && retried.ok === true && retried.data?.ok === true,
    { attempts: retryAttempts },
  );

  // 404 — это ответ сервера, а не сбой связи: повторять нельзя.
  let notFoundAttempts = 0;
  apiClient.defaults.adapter = async (config) => {
    notFoundAttempts += 1;
    const error = new Error('Request failed with status code 404');
    error.config = config;
    error.response = { status: 404, data: { message: 'Маршрут не найден' }, headers: {}, config };
    throw error;
  };
  const notFound = await apiClient.get('/not-found').then(
    () => ({ status: 200 }),
    (error) => ({ status: error.response?.status }),
  );
  apiClient.defaults.adapter = apiAdapter;
  check('api: 404 не повторяется', notFoundAttempts === 1 && notFound.status === 404, { attempts: notFoundAttempts });

  const axiosSource = await readFile(new URL('../src/api/axios.js', import.meta.url), 'utf8');
  check(
    'api: проверка «жив ли API» вынесена в checkApi',
    /export function checkApi\(\)/.test(axiosSource) && /api\.get\('\/health'/.test(axiosSource),
  );

  // Пачка запросов теста закрыта одной проверкой: при перезапуске сервера
  // в консоли одна ошибка вместо четырёх (и без повторов каждого запроса).
  const downCalls = [];
  apiClient.defaults.adapter = async (config) => {
    downCalls.push(String(config.url));
    const error = new Error('Request failed with status code 503');
    error.config = config;
    error.response = { status: 503, data: {}, headers: {}, config };
    throw error;
  };
  await useTestStore.getState().fetchAll('block-down');
  apiClient.defaults.adapter = apiAdapter;

  const downState = useTestStore.getState();
  check(
    'test: при недоступном API запрашивается только /health',
    downCalls.length > 0 && downCalls.every((url) => url === '/health'),
    { calls: downCalls },
  );
  check(
    'test: недоступный API -> спокойная ошибка загрузки',
    downState.error === unavailableText && downState.errorKind === 'server',
    { error: downState.error, kind: downState.errorKind },
  );

  // Проверка идёт до Promise.all: иначе батч уходит в сеть раньше неё.
  const storeSource = await readFile(new URL('../src/store/testStore.js', import.meta.url), 'utf8');
  check(
    'test: checkApi вызывается до загрузки данных',
    storeSource.indexOf('await checkApi()') < storeSource.indexOf('await Promise.all('),
  );

  seed(useTestStore, {
    blockId: 'block-test',
    groups: [],
    sections: [],
    settings: { shuffleQuestions: false, shuffleOptions: false, branching: false, result: null },
    questions: [],
    loading: false,
    loaded: true,
    error: unavailableText,
    errorKind: 'offline',
  });
  seed(useUiStore, { uiMode: 'view' });
  const testOffline = render(TestBlock, '/block/block-test', { block: testBlockData });
  check(
    'test (offline): спокойная плашка вместо красной ошибки',
    testOffline.includes('alert--warn') && !testOffline.includes('alert--error'),
  );
  check(
    'test (offline): подсказка и кнопка «Повторить»',
    testOffline.includes('alert__hint') && testOffline.includes('Повторить'),
  );

  seed(useTestStore, { error: 'Тест не найден', errorKind: 'request' });
  const testRequestError = render(TestBlock, '/block/block-test', { block: testBlockData });
  check(
    'test (error): ошибка запроса остаётся красной',
    testRequestError.includes('alert--error') && !testRequestError.includes('alert--warn'),
  );

  check(
    'test (css): плашка недоступности сервера',
    globalsCss.includes('.alert--warn {') && globalsCss.includes('.alert__hint {'),
  );

  // Прокси Vite: ошибка upstream — это 503 с Retry-After, а не 502 от шлюза.
  const viteConfigSource = await readFile(fileURLToPath(new URL('../vite.config.js', import.meta.url)), 'utf8');
  check(
    'proxy: ошибка upstream превращается в 503 с Retry-After',
    viteConfigSource.includes('handleProxyError') &&
      viteConfigSource.includes("writeHead(503") &&
      viteConfigSource.includes("'Retry-After': '2'"),
  );

  const memoBlockData = {
    id: 'block-memo',
    courseId: 'course-1',
    course: { id: 'course-1', title: 'Охрана труда' },
    type: 'memo',
    title: 'Памятка',
    description: '',
    contentCount: 2,
  };

  seed(useMemoStore, {
    blockId: 'block-memo',
    activeSlideId: 'ms-1',
    slides: [
      {
        id: 'ms-1',
        blockId: 'block-memo',
        title: 'Введение',
        order: 0,
        cells: [
          {
            id: 'm-1',
            blockId: 'block-memo',
            slideId: 'ms-1',
            title: 'Порядок действий',
            titleDoc: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  attrs: { textAlign: 'right' },
                  content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Порядок действий' }],
                },
              ],
            },
            body: docWith('Шаг 1. Надеть каску.'),
            order: 0,
          },
        ],
      },
      {
        id: 'ms-2',
        blockId: 'block-memo',
        title: 'Запреты',
        order: 1,
        cells: [{ id: 'm-2', blockId: 'block-memo', slideId: 'ms-2', title: 'Запрещено', body: docWith('Курить на объекте.'), order: 0 }],
      },
    ],
    loading: false,
    loaded: true,
    error: null,
  });

  seed(useUiStore, { uiMode: 'edit' });
  const memoEdit = render(MemoBlock, '/block/block-memo', { block: memoBlockData });
  check(
    'memo (edit): один слайд и содержание из двух пунктов',
    (memoEdit.match(/class="memo-slide"/g) ?? []).length === 1 &&
      memoEdit.includes('data-memo-id="m-1"') &&
      (memoEdit.match(/class="slide-list__btn"/g) ?? []).length === 2,
  );
  check(
    'memo (edit): карточки слайда — в сетке',
    memoEdit.includes('memo-grid') &&
      memoEdit.includes('memo-card') &&
      memoEdit.includes('memo-card__input') &&
      memoEdit.includes('memo-card__divider'),
  );
  check(
    'memo (edit): один ряд карточек одинаковой высоты, без второй рамки',
    /\.memo-grid\s*\{[^}]*align-items:\s*stretch/.test(globalsCss) &&
      /\.memo-card\s*\{[^}]*height:\s*100%/.test(globalsCss) &&
      /\.memo-card \.content-card\s*\{[^}]*border:\s*0/.test(globalsCss),
  );
  check(
    'memo: разделитель — 1px и светлая линия дизайн-системы',
    /\.memo-card__divider\s*\{[^}]*margin:\s*4px 0[^}]*border-top:\s*1px solid var\(--color-border\)/.test(
      globalsCss,
    ),
  );
  check(
    'memo: docToText не вставляет пробел между inline-узлами заголовка',
    docToText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Заго' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'ловок' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'карточки' }] },
      ],
    }) === 'Заголовок карточки',
  );
  check('memo (edit): второй слайд скрыт до перехода', !memoEdit.includes('Курить на объекте'));
  check('memo (edit): кнопка добавления слайда', memoEdit.includes('title="Добавить слайд"'));
  check(
    'memo (edit): разделитель между заголовком и содержимым',
    memoEdit.includes('memo-slide__divider'),
  );
  check(
    'memo (edit): панель инструментов у текста слайда',
    memoEdit.includes('role="toolbar"') &&
      memoEdit.includes('Жирный') &&
      !memoEdit.includes('Добавить контент'),
  );

  seed(useUiStore, { uiMode: 'view' });
  const memoView = render(MemoBlock, '/block/block-memo', { block: memoBlockData });
  check(
    'memo (view): текст без редактора',
    memoView.includes('Порядок действий') &&
      memoView.includes('Надеть каску') &&
      memoView.includes('memo-slide') &&
      memoView.includes('memo-slide__divider') &&
      memoView.includes('memo-card__divider') &&
      !memoView.includes('aria-label="Название слайда"') &&
      !memoView.includes('Добавить слайд'),
  );
  check(
    'memo (view): форматированный заголовок карточки',
    memoView.includes('<strong>Порядок действий</strong>') && memoView.includes('text-align:right'),
  );
  check('memo (view): панели инструментов нет', !memoView.includes('role="toolbar"'));
  // В просмотре сетка фрагментов лежит прямо в `.memo-card` (без `__body`),
  // поэтому внутреннюю рамку снимает правило `.memo-card .slide-grid`.
  const memoGridViewCss = globalsCss.slice(globalsCss.indexOf('.memo-card .slide-grid'));
  const memoGridViewRule = memoGridViewCss.slice(0, memoGridViewCss.indexOf('}'));
  check(
    'memo (view): сетка фрагментов без второй рамки',
    memoGridViewRule.includes('padding: 0') &&
      memoGridViewRule.includes('border: 0') &&
      memoGridViewRule.includes('box-shadow: none') &&
      !memoView.includes('memo-card__body'),
  );

  const glossaryBlockData = {
    id: 'block-glossary',
    courseId: 'course-1',
    course: { id: 'course-1', title: 'Охрана труда' },
    type: 'glossary',
    title: 'Термины',
    description: '',
    contentCount: 3,
  };

  seed(useGlossaryStore, {
    blockId: 'block-glossary',
    terms: [
      { id: 't-1', blockId: 'block-glossary', term: 'Яблоко', definition: docWith('Плод') },
      { id: 't-2', blockId: 'block-glossary', term: 'Акт', definition: docWith('Документ проверки') },
      { id: 't-3', blockId: 'block-glossary', term: 'Ёж', definition: docWith('Животное') },
    ],
    loading: false,
    loaded: true,
    error: null,
  });

  const glossaryView = render(GlossaryBlock, '/block/block-glossary', { block: glossaryBlockData });
  check(
    'glossary (view): алфавит и разделители букв',
    glossaryView.indexOf('Акт') < glossaryView.indexOf('Ёж') && glossaryView.includes('glossary-group__letter'),
  );
  check('glossary (view): определения', glossaryView.includes('Документ проверки'));
  check(
    'glossary (view): указатель букв для навигации',
    glossaryView.includes('class="glossary-letters"') &&
      glossaryView.includes('glossary-layout') &&
      glossaryView.includes('Перейти к букве А') &&
      glossaryView.includes('id="glossary-letter-А"'),
  );

  seed(useUiStore, { uiMode: 'edit' });
  const glossaryEdit = render(GlossaryBlock, '/block/block-glossary', { block: glossaryBlockData });
  check(
    'glossary (edit): поиск, импорт и новый термин',
    glossaryEdit.includes('Поиск по терминам') &&
      glossaryEdit.includes('Импорт CSV') &&
      glossaryEdit.includes('Новый термин'),
  );
  check(
    'glossary (edit): указателя букв нет — порядок создания',
    !glossaryEdit.includes('glossary-letters') && glossaryEdit.includes('glossary-layout--plain'),
  );
  check(
    'glossary (edit): панель инструментов у определений',
    glossaryEdit.includes('role="toolbar"') &&
      glossaryEdit.includes('Жирный') &&
      !glossaryEdit.includes('Добавить контент'),
  );

  // Глоссарий и памятка: тело карточки — все типы контента, как у слайда теории
  const legacyBody = normalizeContentBody(docWith('Старое определение'), 'term-1');
  check(
    'contentBody: старый документ — один текстовый фрагмент',
    legacyBody.contents.length === 1 &&
      legacyBody.contents[0].type === 'text' &&
      legacyBody.contents[0].id === 'term-1-text',
    JSON.stringify(legacyBody),
  );

  const richBody = {
    version: 2,
    contents: [
      { id: 'fr-text', type: 'text', width: 50, data: docWith('Инструкция по охране труда') },
      {
        id: 'fr-image',
        type: 'image',
        width: 50,
        data: { url: '/uploads/plan.png', alt: 'План эвакуации', caption: 'Схема выхода' },
      },
      {
        id: 'fr-checklist',
        type: 'checklist',
        width: 100,
        data: { title: 'Проверка', columns: 1, items: [{ id: 'i1', text: 'Взять огнетушитель', checked: false }] },
      },
    ],
  };

  check(
    'contentBody: типы, ширины и id фрагментов сохраняются',
    contentBodyContents(richBody, 'card-1').map((item) => `${item.id}:${item.type}:${item.width}`).join(',') ===
      'fr-text:text:50,fr-image:image:50,fr-checklist:checklist:100',
  );
  check(
    'contentBody: текст для поиска по всем фрагментам',
    ['Инструкция по охране труда', 'План эвакуации', 'Взять огнетушитель'].every((text) =>
      contentBodyToText(richBody).includes(text),
    ),
  );
  check('contentBody: битые фрагменты отбрасываются', contentBodyContents({ version: 2, contents: [{ type: 'unknown' }] }).length === 0);

  seed(useMemoStore, {
    blockId: 'block-memo',
    activeSlideId: 'ms-rich',
    slides: [
      {
        id: 'ms-rich',
        blockId: 'block-memo',
        title: 'Слайд 1',
        order: 0,
        cells: [{ id: 'm-rich', blockId: 'block-memo', slideId: 'ms-rich', title: 'Инструкция', body: richBody, order: 0 }],
      },
    ],
    loading: false,
    loaded: true,
    error: null,
  });

  seed(useUiStore, { uiMode: 'edit' });
  const memoRichEdit = render(MemoBlock, '/block/block-memo', { block: memoBlockData });
  check(
    'memo (edit): в карточке доступны все типы контента',
    CONTENT_TYPES.every((item) => memoRichEdit.includes(`>${item.label}<`)) &&
      memoRichEdit.includes('Добавить фрагмент в этот ряд') &&
      memoRichEdit.includes('Добавить фрагмент в новый ряд'),
  );
  check(
    'memo (edit): фрагменты карточки — с редакторами',
    memoRichEdit.includes('content-card__head') &&
      memoRichEdit.includes('Ширина колонки') &&
      memoRichEdit.includes('Взять огнетушитель'),
  );

  seed(useUiStore, { uiMode: 'view' });
  const memoRichView = render(MemoBlock, '/block/block-memo', { block: memoBlockData });
  check(
    'memo (view): фрагменты разных типов в чтении',
    memoRichView.includes('Схема выхода') &&
      memoRichView.includes('src="/uploads/plan.png"') &&
      memoRichView.includes('Взять огнетушитель') &&
      !memoRichView.includes('content-card__head'),
  );

  seed(useGlossaryStore, {
    blockId: 'block-glossary',
    terms: [
      { id: 't-rich', blockId: 'block-glossary', term: 'Эвакуация', definition: richBody },
      { id: 't-plain', blockId: 'block-glossary', term: 'Акт', definition: docWith('Документ проверки') },
    ],
    loading: false,
    loaded: true,
    error: null,
  });

  seed(useUiStore, { uiMode: 'view' });
  const glossaryRichView = render(GlossaryBlock, '/block/block-glossary', { block: glossaryBlockData });
  check(
    'glossary (view): определение из нескольких фрагментов',
    glossaryRichView.includes('Инструкция по охране труда') &&
      glossaryRichView.includes('Схема выхода') &&
      glossaryRichView.includes('Документ проверки'),
  );

  seed(useUiStore, { uiMode: 'edit' });
  const glossaryRichEdit = render(GlossaryBlock, '/block/block-glossary', { block: glossaryBlockData });
  check(
    'glossary (edit): в определении доступны все типы контента',
    CONTENT_TYPES.every((item) => glossaryRichEdit.includes(`>${item.label}<`)) &&
      glossaryRichEdit.includes('Добавить фрагмент в новый ряд'),
  );

  check('glossary (view): панели инструментов нет', !glossaryView.includes('role="toolbar"'));

  // 10.1 Шаг 13: импорт курса — кнопка на дашборде и клиентская проверка файла
  const { default: DashboardPage } = await vite.ssrLoadModule('/src/pages/DashboardPage.jsx');
  const { validateArchiveFile } = await vite.ssrLoadModule('/src/api/courseImport.js');

  check('import: ZIP проходит проверку файла', validateArchiveFile({ name: 'course.zip', size: 1024 }) === null);
  check(
    'import: не ZIP отклоняется',
    Boolean(validateArchiveFile({ name: 'course.rar', size: 1024 })),
  );
  check(
    'import: архив больше 50 МБ отклоняется',
    Boolean(validateArchiveFile({ name: 'course.zip', size: 51 * 1024 * 1024 })),
  );

  seed(useCourseStore, { courses: [], loading: false, loaded: true, error: null });
  seed(useAuthStore, { user: { id: 'u1', login: 'admin', role: 'admin' }, isEditor: true, isAuthenticated: true });

  const dashboardHtml = render(DashboardPage, '/');
  check(
    'import: у редактора есть кнопка «Импорт ZIP»',
    dashboardHtml.includes('Импорт ZIP') && dashboardHtml.includes('accept=".zip,application/zip"'),
  );

  seed(useAuthStore, { user: { id: 'u2', login: 'reader', role: 'reader' }, isEditor: false, isAuthenticated: true });

  const readerDashboardHtml = render(DashboardPage, '/');
  check('import: у читателя кнопки импорта нет', !readerDashboardHtml.includes('Импорт ZIP'));

  seed(useAuthStore, { user: { id: 'u1', login: 'admin', role: 'admin' }, isEditor: true, isAuthenticated: true });

  // 10.2 Шаг 14: экспорт курса — пункт меню и разбор имени файла
  const { archiveFilename } = await vite.ssrLoadModule('/src/api/courseExport.js');

  check(
    'export: имя из filename* (UTF-8)',
    archiveFilename("attachment; filename=\"course.zip\"; filename*=UTF-8''%D0%9A%D1%83%D1%80%D1%81.zip") ===
      'Курс.zip',
  );
  check('export: имя из filename', archiveFilename('attachment; filename="course.zip"') === 'course.zip');
  check('export: запасное имя без заголовка', archiveFilename('') === 'course.zip');

  seed(useCourseStore, {
    courses: [
      { id: 'course-1', title: 'Охрана труда', description: 'Курс', blocksCount: 2, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    loading: false,
    loaded: true,
    error: null,
  });

  const editorCardHtml = render(DashboardPage, '/');
  check('export: у редактора есть пункт «Экспорт ZIP»', editorCardHtml.includes('Экспорт ZIP'));
  check('export: у редактора есть пункт «Печать / PDF»', editorCardHtml.includes('Печать / PDF'));

  seed(useAuthStore, { user: { id: 'u2', login: 'reader', role: 'reader' }, isEditor: false, isAuthenticated: true });

  const readerCardHtml = render(DashboardPage, '/');
  check('export: у читателя пункта «Экспорт ZIP» нет', !readerCardHtml.includes('Экспорт ZIP'));

  seed(useCourseStore, { courses: [], loading: false, loaded: true, error: null });
  seed(useAuthStore, { user: { id: 'u1', login: 'admin', role: 'admin' }, isEditor: true, isAuthenticated: true });

  // 10b. Шаг 15: печатная версия курса
  const { usePrintStore } = await vite.ssrLoadModule('/src/store/printStore.js');

  const printDoc = (text) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  const printCourse = {
    id: 'print-course',
    title: 'Пожарная безопасность',
    description: 'Печатная версия курса',
    updatedAt: '2026-11-12T10:00:00.000Z',
    blocks: [
      {
        id: 'pb-theory',
        type: 'theory',
        title: 'Теория',
        description: 'Слайды для печати',
        coverImage: '/uploads/pb-cover.png',
        slides: [
          {
            id: 'pb-slide-1',
            title: 'Введение',
            order: 0,
            contents: [
              { id: 'pb-c1', type: 'text', width: 66, dataVersion: 1, data: printDoc('Правила пожарной безопасности') },
              { id: 'pb-c2', type: 'important', width: 33, dataVersion: 1, data: printDoc('Не оставляйте огонь без присмотра') },
              {
                id: 'pb-c3',
                type: 'video',
                width: 50,
                dataVersion: 1,
                data: { url: 'https://youtu.be/abc123', caption: 'Видеоинструкция' },
              },
              {
                id: 'pb-c4',
                type: 'table',
                width: 50,
                dataVersion: 1,
                data: { columns: 2, rows: 2, cells: [['Класс', 'Срок'], ['A', '1 год']], headerRow: true },
              },
            ],
          },
          { id: 'pb-slide-2', title: 'Пустой слайд', order: 1, contents: [] },
        ],
      },
      {
        id: 'pb-test',
        type: 'test',
        title: 'Тест',
        description: '',
        coverImage: null,
        questions: [
          {
            id: 'pb-q1',
            type: 'single',
            data: { text: 'Что делать при пожаре?' },
            group: { id: 'pb-g1', name: 'Основы' },
            explanation: printDoc('Звонить 101'),
            options: [
              { id: 'pb-o1', text: 'Звонить 101', isCorrect: true, order: 0 },
              { id: 'pb-o2', text: 'Ждать', isCorrect: false, order: 1 },
            ],
            pairs: [],
          },
          {
            id: 'pb-q2',
            type: 'match',
            data: { text: 'Сопоставьте' },
            options: [],
            pairs: [{ id: 'pb-p1', left: 'Огонь', right: '101', order: 0 }],
          },
          { id: 'pb-q3', type: 'card', data: { front: 'Огнетушитель', back: 'Средство тушения' }, options: [], pairs: [] },
        ],
      },
      {
        id: 'pb-memo',
        type: 'memo',
        title: 'Памятка',
        description: '',
        coverImage: null,
        memoSlides: [
          {
            id: 'pb-ms1',
            title: 'Слайд 1',
            cells: [
              { id: 'pb-m1', title: 'Эвакуация', body: printDoc('Порядок действий') },
              {
                id: 'pb-m2',
                title: 'Осмотр',
                body: {
                  version: 2,
                  contents: [
                    {
                      id: 'pb-f1',
                      type: 'checklist',
                      width: 100,
                      data: {
                        title: 'Перед выходом',
                        columns: 1,
                        items: [{ id: '1', text: 'Проверить огнетушитель', checked: false }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      {
        id: 'pb-glossary',
        type: 'glossary',
        title: 'Глоссарий',
        description: '',
        coverImage: null,
        terms: [
          { id: 'pb-t2', term: 'Эвакуация', definition: printDoc('Выход из здания') },
          { id: 'pb-t1', term: 'Огнетушитель', definition: printDoc('Средство тушения') },
          {
            id: 'pb-t3',
            term: 'Инструктаж',
            definition: {
              version: 2,
              contents: [
                {
                  id: 'pb-f2',
                  type: 'important',
                  width: 100,
                  data: printDoc('Проводится раз в квартал'),
                },
              ],
            },
          },
        ],
      },
    ],
  };

  seed(usePrintStore, {
    course: printCourse,
    generatedAt: '2026-11-15T09:00:00.000Z',
    loading: false,
    loaded: true,
    error: null,
    notFound: false,
    showAnswers: true,
  });
  seed(useAuthStore, { isEditor: true, isAuthenticated: true });

  const printHtml = render(App, '/course/print-course/print');
  check('print: документ отрисован', printHtml.includes('print-doc'));
  check(
    'print: панель и кнопка печати',
    printHtml.includes('print-toolbar') && printHtml.includes('Печать / Сохранить в PDF'),
  );
  check('print: название и описание курса', printHtml.includes('Пожарная безопасность') && printHtml.includes('Печатная версия курса'));
  check('print: метаданные документа', printHtml.includes('4 блока') && printHtml.includes('12.11.2026'));
  check('print: содержание по блокам', printHtml.includes('Содержание') && printHtml.includes('Теория') && printHtml.includes('Глоссарий'));

  check(
    'print: слайды и обложка блока',
    printHtml.includes('Введение') && printHtml.includes('Пустой слайд') && printHtml.includes('src="/uploads/pb-cover.png"'),
  );
  check(
    'print: текст и «важное» из контента',
    printHtml.includes('Правила пожарной безопасности') &&
      printHtml.includes('Не оставляйте огонь без присмотра') &&
      printHtml.includes('content-important'),
  );
  check('print: пустой слайд помечен', printHtml.includes('На слайде нет материалов.'));
  check(
    'print: видео — ссылкой, без iframe',
    printHtml.includes('https://youtu.be/abc123') && printHtml.includes('Видеоинструкция') && !printHtml.includes('<iframe'),
  );
  check('print: таблица контента', printHtml.includes('Класс') && printHtml.includes('1 год'));

  check(
    'print: вопрос, группа и варианты',
    printHtml.includes('Что делать при пожаре?') && printHtml.includes('Основы') && printHtml.includes('Ждать'),
  );
  check('print: верный ответ отмечен', printHtml.includes('print-option is-correct'));
  check('print: пояснение показано с ответами', printHtml.includes('Пояснение'));
  check('print: пары сопоставления', printHtml.includes('Сопоставьте') && printHtml.includes('>Огонь<') && printHtml.includes('>101<'));
  check('print: карточка вопрос-ответ', printHtml.includes('Средство тушения'));
  check('print: карточка памятки', printHtml.includes('Порядок действий'));
  check(
    'print: памятка — фрагменты карточки (чек-лист)',
    printHtml.includes('Проверить огнетушитель') && printHtml.includes('Перед выходом'),
  );

  const glossarySlice = printHtml.slice(printHtml.indexOf('print-glossary'));
  check(
    'print: глоссарий по алфавиту',
    glossarySlice.indexOf('Огнетушитель') !== -1 && glossarySlice.indexOf('Огнетушитель') < glossarySlice.indexOf('Эвакуация'),
  );
  check(
    'print: глоссарий — определение из фрагментов',
    glossarySlice.includes('Проводится раз в квартал') && glossarySlice.includes('content-important'),
  );

  // Ответы выключены: без отметок, пояснений и обратной стороны карточки
  seed(usePrintStore, { showAnswers: false });
  const plainPrintHtml = render(App, '/course/print-course/print');
  check('print: без ответов нет отметок', !plainPrintHtml.includes('print-option is-correct'));
  check('print: без ответов нет пояснений', !plainPrintHtml.includes('Пояснение'));
  check('print: без ответов нет обратной стороны карточки', !plainPrintHtml.includes('print-label">Ответ<'));
  check('print: сам документ на месте', plainPrintHtml.includes('Что делать при пожаре?'));

  seed(usePrintStore, { course: null, loaded: true, notFound: true, showAnswers: true });
  const printMissingHtml = render(App, '/course/missing/print');
  check('print: курс не найден', printMissingHtml.includes('Курс не найден') && printMissingHtml.includes('К списку курсов'));

  seed(useAuthStore, { isAuthenticated: false });
  const printUnauthorizedHtml = (() => {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    const html = render(App, '/course/print-course/print');
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    return html;
  })();
  check('print: без авторизации редирект', printUnauthorizedHtml === '');

  seed(useAuthStore, { user: { id: 'u1', login: 'admin', role: 'admin' }, isEditor: true, isAuthenticated: true });
  seed(usePrintStore, {
    course: printCourse,
    generatedAt: '2026-11-15T09:00:00.000Z',
    loading: false,
    loaded: true,
    error: null,
    notFound: false,
    showAnswers: true,
  });

  // 11. Шаг 12: темы оформления
  const { default: ThemeEditorPage } = await vite.ssrLoadModule('/src/pages/ThemeEditorPage.jsx');
  const { default: ThemeCard } = await vite.ssrLoadModule('/src/components/theme/ThemeCard.jsx');
  const { default: ThemeEditor } = await vite.ssrLoadModule('/src/components/theme/ThemeEditor.jsx');
  const { useThemeStore } = await vite.ssrLoadModule('/src/store/themeStore.js');
  const {
    DEFAULT_THEME_COLORS,
    contrastText,
    copyThemeName,
    draftFromTheme,
    normalizeHex,
    themeVariables,
    validateThemeDraft,
  } = await vite.ssrLoadModule('/src/utils/themes.js');

  check('themes: normalizeHex раскрывает короткую запись', normalizeHex('#abc') === '#AABBCC', normalizeHex('#abc'));
  check('themes: normalizeHex отклоняет мусор', normalizeHex('красный') === null && normalizeHex('#12345') === null);
  check('themes: на тёмном акценте белый текст', contrastText('#111827') === '#FFFFFF');
  check('themes: на светлом акценте тёмный текст', contrastText('#E0A458') === '#1B1B16');

  const themeVars = themeVariables(DEFAULT_THEME_COLORS);
  check(
    'themes: CSS-переменные из ролей',
    themeVars['--color-primary'] === DEFAULT_THEME_COLORS.accent &&
      themeVars['--color-bg'] === DEFAULT_THEME_COLORS.background,
  );
  check('themes: девять переменных оформления', Object.keys(themeVars).length === 9, Object.keys(themeVars).join(','));

  const badDraft = validateThemeDraft({ name: '', colors: { ...DEFAULT_THEME_COLORS, accent: 'нет' } });
  check('themes: черновик без названия не проходит', !badDraft.ok && Boolean(badDraft.errors.name));
  check('themes: кривой HEX не проходит', Boolean(badDraft.errors['colors.accent']));
  check(
    'themes: короткая палитра не проходит',
    !validateThemeDraft({ name: 'Т', colors: { ...DEFAULT_THEME_COLORS, themeColors: ['#FFF'] } }).ok,
  );
  check('themes: корректный черновик проходит', validateThemeDraft({ name: 'Т', colors: DEFAULT_THEME_COLORS }).ok);

  const shortThemeDraft = draftFromTheme({ name: 'Классическая', colors: { accent: '#abc', themeColors: ['#fff'] } });
  check(
    'themes: черновик дополняет палитру до 10',
    shortThemeDraft.colors.themeColors.length === 10 && shortThemeDraft.colors.accent === '#AABBCC',
  );
  check('themes: имя копии', copyThemeName('Классическая') === 'Копия — Классическая');

  const sampleThemes = [
    {
      id: 'theme-1',
      name: 'Классическая',
      colors: DEFAULT_THEME_COLORS,
      isGlobal: true,
      ownerId: null,
      isOwn: false,
      isActive: true,
      canEdit: true,
      canDelete: false,
    },
    {
      id: 'theme-2',
      name: 'Моя тема',
      colors: { ...DEFAULT_THEME_COLORS, accent: '#2F6F6B' },
      isGlobal: false,
      ownerId: 'u1',
      isOwn: true,
      isActive: false,
      canEdit: true,
      canDelete: true,
    },
  ];

  seed(useThemeStore, {
    themes: sampleThemes,
    activeThemeId: 'theme-1',
    defaultThemeId: 'theme-1',
    loading: false,
    loaded: true,
    error: null,
    saving: false,
  });
  seed(useAuthStore, { user: { id: 'u1', login: 'admin', role: 'admin' }, isEditor: true, isAuthenticated: true });

  const themesHtml = render(ThemeEditorPage, '/themes');
  check('themes: две карточки тем', (themesHtml.match(/class="theme-card(?![-\w])/g) ?? []).length === 2);
  check('themes: бейджи «Глобальная» и «Личная»', themesHtml.includes('Глобальная') && themesHtml.includes('Личная'));
  check('themes: активная тема отмечена', themesHtml.includes('>Активна<'));
  check('themes: палитра по 10 цветов', (themesHtml.match(/class="theme-card__dot"/g) ?? []).length === 20);
  check('themes: кнопка новой темы', themesHtml.includes('Новая тема'));

  const noop = () => {};
  const globalCardHtml = render(ThemeCard, '/themes', {
    theme: sampleThemes[0],
    onApply: noop,
    onEdit: noop,
    onCopy: noop,
    onDelete: noop,
  });
  check(
    'themes: у глобальной темы нет кнопки удаления',
    !globalCardHtml.includes('Удалить') && globalCardHtml.includes('Копия'),
  );

  const themeFormHtml = render(ThemeEditor, '/themes', { initial: draftFromTheme(sampleThemes[1]) });
  check('themes: в форме шесть полей цвета', (themeFormHtml.match(/id="theme-color-/g) ?? []).length === 6);
  check('themes: палитра из 10 свотчей', (themeFormHtml.match(/class="color-field__swatch"/g) ?? []).length === 10);
  check('themes: предпросмотр в форме', themeFormHtml.includes('theme-preview'));

  // 11.1 Шаблоны CSV теста: ссылки на скачивание в модалке импорта
  const { default: CsvImportModal } = await vite.ssrLoadModule('/src/components/block/CsvImportModal.jsx');
  const { TEST_CSV_TEMPLATES } = await vite.ssrLoadModule('/src/utils/csv.js');

  const csvModalHtml = render(CsvImportModal, '/', {
    templates: TEST_CSV_TEMPLATES,
    parse: (text) => csvToQuestions(parseCsv(text).rows),
    onImport: async () => ({ ok: true, created: 0 }),
    onClose: noop,
  });

  check(
    'csv: в модалке три шаблона',
    (csvModalHtml.match(/class="csv-import__template"/g) ?? []).length === 3,
  );
  check(
    'csv: имена файлов шаблонов',
    ['Вопрос одиночный или множественный.csv', 'Карточки.csv', 'Соответствие.csv'].every((name) =>
      csvModalHtml.includes(`download="${name}"`),
    ),
  );
  check(
    'csv: ссылка шаблона с BOM для Excel',
    csvModalHtml.includes('data:text/csv;charset=utf-8,%EF%BB%BF'),
  );

  // Предпросмотр импорта: первые пять строк и «…и ещё N».
  const previewItems = Array.from({ length: 7 }, (_, index) => ({
    type: index === 0 ? 'multiple' : 'single',
    data: { text: `Вопрос ${index + 1}` },
    options: [{ text: 'A' }, { text: 'B' }],
    group: index === 0 ? 'Основы' : null,
  }));

  const csvPreviewHtml = render(CsvImportModal, '/', {
    templates: TEST_CSV_TEMPLATES,
    parse: () => ({ items: previewItems, errors: [] }),
    preview: (items) => items.map((item) => `${item.type}: ${item.data.text}`),
    onImport: async () => ({ ok: true, created: 0 }),
    onClose: noop,
  });

  check(
    'csv: предпросмотр показывает пять строк',
    (csvPreviewHtml.match(/class="csv-import__preview-row"/g) ?? []).length === 5 &&
      csvPreviewHtml.includes('multiple: Вопрос 1') &&
      csvPreviewHtml.includes('single: Вопрос 5'),
  );
  check('csv: предпросмотр сворачивает остаток', csvPreviewHtml.includes('…и ещё 2'));



  // 12. Остальные маршруты не падают при рендере
  for (const path of ['/course/course-1', '/block/block-1', '/themes', '/course/print-course/print']) {
    const html = render(App, path);
    check(`route ${path}: отрисован`, html.length > 0);
  }

  // Неизвестный адрес отдаёт <Navigate to="/"> — на сервере это пустая разметка.
  // react-router предупреждает про Navigate при первом рендере в StaticRouter — глушим на этот рендер.
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  const unknownHtml = render(App, '/unknown');
  console.error = originalError;
  console.warn = originalWarn;
  check('route /unknown: редирект без падения', unknownHtml === '');
} finally {
  await vite.close();
}

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

// Отчёт пишем файлом: консоль Windows ломает кириллицу при перенаправлении.
await writeFile(
  fileURLToPath(new URL('../render-check.json', import.meta.url)),
  JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2),
  'utf8',
);

process.exitCode = failed.length ? 1 : 0;
