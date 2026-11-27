/**
 * Проверка редактора Tiptap без браузера: поднимает jsdom, создаёт Editor
 * с теми же расширениями, что и TiptapEditor.jsx, и прогоняет команды тулбара.
 *
 * Запуск: node scripts/editor-check.mjs
 */
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body><div id="editor-host"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getSelection = dom.window.getSelection.bind(dom.window);
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const root = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

const vite = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

try {
  const { buildExtensions } = await vite.ssrLoadModule('/src/components/editor/TiptapEditor.jsx');
  const { Editor } = await vite.ssrLoadModule('@tiptap/core');

  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Заголовок' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Текст теории' }] },
    ],
  };

  const editor = new Editor({
    element: document.getElementById('editor-host'),
    extensions: buildExtensions('Начните печатать…'),
    content: doc,
  });

  check('editor: создан с расширениями', Boolean(editor.view) && editor.extensionManager.extensions.length > 10, editor.extensionManager.extensions.length);

  // Выделяем весь документ и прогоняем команды тулбара
  editor.commands.selectAll();

  const commands = [
    ['bold', () => editor.chain().focus().toggleBold().run()],
    ['italic', () => editor.chain().focus().toggleItalic().run()],
    ['underline', () => editor.chain().focus().toggleUnderline().run()],
    ['strike', () => editor.chain().focus().toggleStrike().run()],
    ['code', () => editor.chain().focus().toggleCode().run()],
    ['highlight', () => editor.chain().focus().toggleHighlight({ color: '#fde68a' }).run()],
    ['color', () => editor.chain().focus().setColor('#2563eb').run()],
    ['fontFamily', () => editor.chain().focus().setMark('textStyle', { fontFamily: 'Arial' }).run()],
    ['fontSize', () => editor.chain().focus().setMark('textStyle', { fontSize: '16pt' }).run()],
    ['subscript', () => editor.chain().focus().toggleSubscript().run()],
    ['superscript', () => editor.chain().focus().toggleSuperscript().run()],
    ['alignCenter', () => editor.chain().focus().setTextAlign('center').run()],
    ['link', () => editor.chain().focus().setLink({ href: 'https://example.com' }).run()],
    ['bulletList', () => editor.chain().focus().toggleBulletList().run()],
    ['orderedList', () => editor.chain().focus().toggleOrderedList().run()],
    ['paragraph', () => editor.chain().focus().setParagraph().run()],
    ['heading3', () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
    ['unsetAllMarks', () => editor.chain().focus().unsetAllMarks().clearNodes().run()],
    ['undo', () => editor.chain().focus().undo().run()],
    ['redo', () => editor.chain().focus().redo().run()],
    ['unsetColor', () => editor.chain().focus().unsetColor().run()],
    ['unsetHighlight', () => editor.chain().focus().unsetHighlight().run()],
    ['unsetLink', () => editor.chain().focus().unsetLink().run()],
  ];

  for (const [name, run] of commands) {
    try {
      run();
      check(`editor: команда ${name}`, true);
    } catch (error) {
      check(`editor: команда ${name}`, false, error.message);
    }
  }

  // Проверяем, что JSON сохраняется и читается обратно
  const json = editor.getJSON();
  check('editor: getJSON возвращает doc', json.type === 'doc' && Array.isArray(json.content));
  check('editor: isActive после сброса', editor.isActive('bold') === false);

  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Новый текст' }] }] });
  check('editor: setContent + getText', editor.getText().includes('Новый текст'));

  // ===== Многоуровневые списки (Правка 4) =====
  const {
    collectListNumbering,
    computeNumbering,
    DEFAULT_LIST_LEVELS,
    MAX_LIST_LEVELS,
    formatListNumber,
  } = await vite.ssrLoadModule('/src/utils/listNumbering.js');
  const { applyListLevels, ensureRootListId, getCurrentListLevels } = await vite.ssrLoadModule(
    '/src/components/editor/extensions/multiLevelList.js',
  );

  const listItem = (text, extra = []) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...extra],
  });

  const sample = {
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { listId: 'list-a' },
        content: [
          listItem('Первый'),
          listItem('Второй', [
            { type: 'orderedList', content: [listItem('Вложенный'), listItem('Ещё')] },
          ]),
          listItem('Третий'),
        ],
      },
      { type: 'orderedList', attrs: { listId: 'list-b' }, content: [listItem('Свой')] },
    ],
  };

  const labelsOf = (content, listId = null) => computeNumbering(content, listId).map((item) => item.label).join(' ');

  check('list: 9 уровней по умолчанию', MAX_LIST_LEVELS === 9 && DEFAULT_LIST_LEVELS.length === 9);
  check('list: иерархия номеров 1, 2, 2.1, 2.2, 3', labelsOf(sample.content) === '1. 2. 2.1. 2.2. 3. 1.', labelsOf(sample.content));
  check('list: второй список нумеруется с 1', labelsOf(sample.content, 'list-b') === '1.');
  check(
    'list: пункты фильтруются по listId',
    collectListNumbering(sample.content).items.filter((item) => item.listId === 'list-a').length === 5,
  );
  check(
    'list: форматы номеров',
    formatListNumber(3, 'lower-alpha') === 'c' &&
      formatListNumber(4, 'upper-roman') === 'IV' &&
      formatListNumber(2, 'decimal') === '2',
  );

  const findPos = (text) => {
    let found = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) found = pos;
    });
    return found;
  };
  const domLabels = () =>
    [...document.querySelectorAll('.tiptap li[data-list-label]')].map((item) => item.getAttribute('data-list-label'));
  const domLevelOf = (text) =>
    [...document.querySelectorAll('.tiptap li[data-list-level]')]
      .find((item) => item.textContent.trim() === text)
      ?.getAttribute('data-list-level');

  editor.commands.setContent(sample);
  check('list: подписи пунктов в DOM', domLabels().join(' ') === '1. 2. 2.1. 2.2. 3. 1.', domLabels().join(' '));
  check('list: уровень вложенного пункта в DOM', domLevelOf('Вложенный') === '1');

  editor.commands.setTextSelection(findPos('Третий') + 1);
  check('list: настройки списка под курсором', getCurrentListLevels(editor).length === MAX_LIST_LEVELS);

  const customLevels = DEFAULT_LIST_LEVELS.map((level, index) =>
    index === 0 ? { ...level, style: 'upper-roman', template: '%1', suffix: ')' } : level,
  );
  check('list: настройки применены к списку', applyListLevels(editor, customLevels));
  check('list: номера по настройкам списка', domLabels()[0] === 'I)' && domLabels()[2] === '2.1.', domLabels().join(' '));
  check('list: настройки уровней в JSON', editor.getJSON().content[0].attrs?.levels?.[0].style === 'upper-roman');
  check('list: уровни сохраняются в HTML', editor.getHTML().includes('data-levels'));

  // Enter / Tab / Backspace обрабатывает ListKeymap из StarterKit
  const pressKey = (key) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event));
  };

  const oneItem = {
    type: 'doc',
    content: [{ type: 'orderedList', attrs: { listId: 'list-keys' }, content: [listItem('Пункт')] }],
  };

  editor.commands.setContent(oneItem);
  editor.commands.setTextSelection(findPos('Пункт') + 'Пункт'.length);
  pressKey('Enter');
  check('list: Enter создаёт следующий пункт', editor.getJSON().content[0].content.length === 2);

  pressKey('Tab');
  check(
    'list: Tab понижает уровень',
    (JSON.stringify(editor.getJSON()).match(/orderedList/g) ?? []).length === 2,
    JSON.stringify(editor.getJSON()).slice(0, 140),
  );

  editor.commands.setContent(oneItem);
  editor.commands.setTextSelection(findPos('Пункт') + 'Пункт'.length);
  pressKey('Enter');
  pressKey('Backspace');
  const afterBackspace = editor.getJSON();
  check(
    'list: Backspace в пустом пункте выводит из списка',
    afterBackspace.content.some((node) => node.type === 'paragraph') && afterBackspace.content[0].content.length === 1,
    JSON.stringify(afterBackspace).slice(0, 160),
  );

  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Новый список' }] }],
  });
  editor.commands.setTextSelection(findPos('Новый список') + 1);
  editor.chain().focus().toggleOrderedList().run();
  const newListId = ensureRootListId(editor);
  check(
    'list: listId появляется у нового списка',
    Boolean(newListId) && editor.getJSON().content[0].attrs?.listId === newListId,
  );

  // ===== Примечания к тексту (Правка 5) =====
  const { NOTE_MAX_LENGTH, annotateNotes, collectNotes, normalizeNoteText } = await vite.ssrLoadModule(
    '/src/utils/notes.js',
  );
  const {
    findInlineNote,
    getNoteAtSelection,
    insertInlineNote,
    removeInlineNote,
    updateInlineNote,
  } = await vite.ssrLoadModule('/src/components/editor/extensions/inlineNote.js');

  const noteDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Пожарная безопасность важна для всех' }],
      },
    ],
  };

  // Диапазон слова в документе: пригодится и для выделения, и для проверок
  const wordRange = (word) => {
    let range = null;
    editor.state.doc.descendants((node, position) => {
      if (!node.isText) return;

      const index = node.text.indexOf(word);
      if (index >= 0) range = { from: position + index, to: position + index + word.length };
    });
    return range;
  };

  editor.commands.setContent(noteDoc);
  const fireRange = wordRange('Пожарная');
  editor.commands.setTextSelection(fireRange);

  check('notes: примечание добавлено', insertInlineNote(editor, '  Термин из ГОСТ 12.1.004  '));
  check(
    'notes: метка и текст в JSON',
    editor.getJSON().content[0].content[0].marks?.[0]?.type === 'inlineNote' &&
      editor.getJSON().content[0].content[0].marks?.[0]?.attrs?.text === 'Термин из ГОСТ 12.1.004',
    JSON.stringify(editor.getJSON().content[0].content[0].marks),
  );
  check('notes: метка в HTML', editor.getHTML().includes('data-note-id="note-'));

  const markerOf = (number) =>
    [...editor.view.dom.querySelectorAll('.inline-note__mark')].find(
      (item) => item.getAttribute('data-note-number') === String(number),
    );

  check('notes: номер в DOM', Boolean(markerOf(1)) && markerOf(1).textContent === '1');

  editor.commands.setTextSelection(fireRange.from + 1);
  const noteAtCursor = getNoteAtSelection(editor);
  check(
    'notes: примечание под курсором',
    Boolean(noteAtCursor) && noteAtCursor.text === 'Термин из ГОСТ 12.1.004' && noteAtCursor.from === fireRange.from,
    JSON.stringify(noteAtCursor),
  );

  const safetyRange = wordRange('безопасность');
  editor.commands.setTextSelection(safetyRange);
  insertInlineNote(editor, 'Огнестойкость конструкций');
  check('notes: второе примечание получает номер 2', Boolean(markerOf(2)));
  check(
    'notes: нумерация в JSON',
    collectNotes(editor.getJSON())
      .map((note) => `${note.number}:${note.text}`)
      .join(' | ') === '1:Термин из ГОСТ 12.1.004 | 2:Огнестойкость конструкций',
    collectNotes(editor.getJSON())
      .map((note) => note.noteId)
      .join(','),
  );


  const firstNote = findInlineNote(editor, collectNotes(editor.getJSON())[0].noteId);
  check('notes: findInlineNote возвращает диапазон', Boolean(firstNote) && firstNote.from === fireRange.from);
  check('notes: текст примечания обновлён', updateInlineNote(editor, firstNote.noteId, 'Определение из ГОСТ'));
  check(
    'notes: новый текст в DOM',
    editor.view.dom.querySelector('.inline-note')?.getAttribute('data-note-text') === 'Определение из ГОСТ',
  );

  // Просмотру нужен признак «после этого слова рисуем номер»
  const annotatedNote = annotateNotes(editor.getJSON());
  check(
    'notes: annotateNotes ставит номер и признак маркера',
    annotatedNote.content[0].content[0].marks?.[0]?.attrs?.noteNumber === 1 &&
      annotatedNote.content[0].content[0].marks?.[0]?.attrs?.noteMarker === true,
    JSON.stringify(annotatedNote.content[0].content[0].marks),
  );

  // Ctrl+Alt+M: расширение сообщает панели инструментов событием редактора
  let requested = 0;
  const onRequest = () => {
    requested += 1;
  };
  editor.on('inline-note:request', onRequest);
  const hotkeyEvent = new dom.window.KeyboardEvent('keydown', {
    key: 'm',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  const handled = editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, hotkeyEvent));
  editor.off('inline-note:request', onRequest);
  check('notes: Ctrl+Alt+M открывает поле примечания', Boolean(handled) && requested === 1, `requested=${requested}`);

  check('notes: примечание удалено', removeInlineNote(editor, firstNote.noteId));
  check(
    'notes: нумерация пересчитана после удаления',
    editor.view.dom.querySelectorAll('.inline-note__mark').length === 1 &&
      markerOf(1)?.getAttribute('data-note-text') === 'Огнестойкость конструкций',
  );
  check(
    'notes: текст ограничен по длине',
    normalizeNoteText('  a  '.repeat(200)).length === NOTE_MAX_LENGTH,
    normalizeNoteText('  a  '.repeat(200)).length,
  );

  // Номера сквозные по слайду: фрагмент знает, сколько примечаний было до него
  const { collectSlideNotes, createPlainNote, plainNoteNumbers, splitNoteText } = await vite.ssrLoadModule(
    '/src/utils/notes.js',
  );

  const paraDoc = (noteId, text, word) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: word, marks: [{ type: 'inlineNote', attrs: { noteId, text } }] }],
      },
    ],
  });

  const slideContents = [
    { id: 'c1', type: 'text', data: paraDoc('note-s1', 'Первое примечание', 'Пожарная') },
    {
      id: 'c2',
      type: 'table',
      data: {
        columns: 1,
        rows: 1,
        cells: [['Ячейка']],
        notes: [{ id: 'note-s2', text: 'Второе примечание', field: 'cell', ref: '0-0', from: 0, to: 6, word: 'Ячейка' }],
      },
    },
    {
      id: 'c3',
      type: 'checklist',
      data: {
        title: 'Чек-лист',
        columns: 1,
        items: [{ id: '1', text: 'Пункт', checked: false }],
        notes: [{ id: 'note-s3', text: 'Третье примечание', field: 'item', ref: '1', from: 0, to: 5, word: 'Пункт' }],
      },
    },
  ];

  const slideNotes = collectSlideNotes(slideContents);
  check(
    'notes: номера сквозные по слайду',
    slideNotes.total === 3 &&
      slideNotes.numberById.get('note-s1') === 1 &&
      slideNotes.numberById.get('note-s2') === 2 &&
      slideNotes.numberById.get('note-s3') === 3,
    JSON.stringify([...slideNotes.numberById]),
  );
  check(
    'notes: смещение считается по предыдущим фрагментам',
    slideNotes.offsetById.get('c1') === 0 &&
      slideNotes.offsetById.get('c2') === 1 &&
      slideNotes.offsetById.get('c3') === 2,
    JSON.stringify([...slideNotes.offsetById]),
  );
  check(
    'notes: номера обычного текста продолжают слайд',
    plainNoteNumbers(slideContents[1].data, 1).get('note-s2') === 2,
  );

  const splitParts = splitNoteText('Проверить огнетушитель', [
    { id: 'note-p1', text: 'Пункт инструкции', field: 'item', ref: '1', from: 10, to: 22, word: 'огнетушитель' },
  ]);
  check(
    'notes: слово с примечанием выделено',
    splitParts.length === 2 &&
      splitParts[1].note?.id === 'note-p1' &&
      splitParts[1].text === 'огнетушитель',
    JSON.stringify(splitParts),
  );
  check(
    'notes: слово ищется заново после правки текста',
    splitNoteText('Срочно проверить огнетушитель', [
      { id: 'note-p1', text: 'Пункт инструкции', field: 'item', ref: '1', from: 10, to: 22, word: 'огнетушитель' },
    ])[1].text === 'огнетушитель',
  );

  // Правка «Работа с таблицей»: ячейки — Tiptap-документы, объединения, буфер обмена
  const table = await vite.ssrLoadModule('/src/utils/table.js');

  const legacyTable = table.normalizeTableData({
    columns: 2,
    rows: 2,
    headerRow: true,
    cells: [
      ['Срок', 'Год'],
      ['Три года', ''],
    ],
    notes: [{ id: 'n-cell', text: 'Из ГОСТ', field: 'cell', ref: '0-0', from: 0, to: 4, word: 'Срок' }],
    links: [
      {
        id: 'l-cell',
        field: 'cell',
        ref: '0-1',
        from: 0,
        to: 3,
        word: 'Год',
        kind: 'internal',
        href: '/block/b1',
        targetType: 'block',
        targetBlockId: 'b1',
      },
    ],
  });

  check(
    'table: старые строки стали документами',
    table.isCellDoc(legacyTable.cells[0][0]) && table.docToPlainText(legacyTable.cells[0][0]) === 'Срок',
    JSON.stringify(legacyTable.cells[0][0]),
  );
  check(
    'table: примечание старого формата стало меткой',
    legacyTable.cells[0][0].content[0].content[0].marks?.[0]?.type === 'inlineNote' &&
      legacyTable.cells[0][0].content[0].content[0].marks[0].attrs.noteId === 'n-cell',
    JSON.stringify(legacyTable.cells[0][0]),
  );
  check(
    'table: ссылка старого формата стала меткой link',
    legacyTable.cells[0][1].content[0].content[0].marks?.[0]?.type === 'link' &&
      legacyTable.cells[0][1].content[0].content[0].marks[0].attrs.targetBlockId === 'b1',
    JSON.stringify(legacyTable.cells[0][1]),
  );

  const mergedTable = table.mergeRectCells(legacyTable, { top: 0, left: 0, bottom: 1, right: 1 });
  check(
    'table: объединение 2×2',
    mergedTable.merges.length === 1 &&
      mergedTable.merges[0].rowSpan === 2 &&
      mergedTable.merges[0].colSpan === 2 &&
      table.docToPlainText(mergedTable.cells[1][1]) === '',
    JSON.stringify(mergedTable.merges),
  );
  check('table: текст остаётся в верхней левой ячейке', table.docToPlainText(mergedTable.cells[0][0]) === 'Срок');
  check(
    'table: закрытые ячейки не рисуются',
    table.isCovered(mergedTable.merges, 0, 1) && !table.isCovered(mergedTable.merges, 0, 0),
  );
  check(
    'table: «Объединить» доступно только на диапазоне',
    table.canMerge(legacyTable, { top: 0, left: 0, bottom: 0, right: 1 }) &&
      !table.canMerge(legacyTable, { top: 0, left: 0, bottom: 0, right: 0 }),
  );
  check(
    'table: «Объединить» предупреждает о тексте в других ячейках',
    table.hasTextOutsideAnchor(legacyTable, { top: 0, left: 0, bottom: 1, right: 1 }),
  );
  check('table: разделение убирает объединение', table.unmergeRectCells(mergedTable, { top: 0, left: 0, bottom: 0, right: 0 }).merges.length === 0);

  const matrix = Array.from({ length: 7 }, (_, row) => ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((letter) => `${letter}${row + 1}`));
  const paste = table.pasteMatrix(
    table.normalizeTableData({ columns: 1, rows: 1, cells: [['']] }),
    { row: 0, col: 0 },
    matrix,
  );
  check(
    'table: вставка расширяет таблицу в пределах лимитов',
    paste.data.rows === 7 &&
      paste.data.columns === 6 &&
      table.docToPlainText(paste.data.cells[0][1]) === 'B1' &&
      table.docToPlainText(paste.data.cells[6][0]) === 'A7',
    JSON.stringify({ rows: paste.data.rows, columns: paste.data.columns, last: table.docToPlainText(paste.data.cells[6][0]) }),
  );

  const clearedTable = table.clearRect(legacyTable, { top: 0, left: 0, bottom: 1, right: 1 });
  check(
    'table: Delete очищает диапазон',
    clearedTable.cells.every((row) => row.every((doc) => table.docToPlainText(doc) === '')),
  );
  check(
    'table: копирование в TSV',
    table.tableToTsv(legacyTable) === 'Срок\tГод\nТри года\t',
    JSON.stringify(table.tableToTsv(legacyTable)),
  );
  check(
    'table: стрелки переходят между ячейками',
    table.nextAnchor(legacyTable, { row: 0, col: 1 }, 'down').row === 1 &&
      table.nextAnchor(legacyTable, { row: 0, col: 0 }, 'up').row === 0,
  );
  check('table: Tab идёт по порядку обхода', table.nextInOrder(legacyTable, { row: 0, col: 1 }, 1).row === 1);

  const plainNote = createPlainNote({ field: 'cell', ref: '0-1', from: 2, to: 10, word: '  Пожарная  ', text: '  Термин  ' });
  check(
    'notes: примечание обычного текста нормализуется',
    plainNote?.id?.startsWith('note-') && plainNote.text === 'Термин' && plainNote.word === 'Пожарная' && plainNote.ref === '0-1',
    JSON.stringify(plainNote),
  );

  // Редактор получает смещение слайда: номер продолжается, а не начинается с 1
  const offsetHost = document.createElement('div');
  document.body.append(offsetHost);

  const offsetEditor = new Editor({
    element: offsetHost,
    extensions: buildExtensions('Начните печатать…', 2),
    content: noteDoc,
  });

  offsetEditor.commands.setTextSelection({ from: 1, to: 9 });
  insertInlineNote(offsetEditor, 'Термин из ГОСТ');
  check(
    'notes: редактор нумерует с учётом слайда',
    offsetEditor.view.dom.querySelector('.inline-note__mark')?.getAttribute('data-note-number') === '3',
    offsetEditor.view.dom.querySelector('.inline-note__mark')?.outerHTML,
  );

  // Изменение смещения (примечание добавили в предыдущий фрагмент) перерисовывает номер
  offsetEditor.storage.inlineNoteNumbering.offset = 0;
  offsetEditor.view.dispatch(offsetEditor.state.tr.setMeta('addToHistory', false));
  check(
    'notes: смена смещения пересчитывает номер',
    offsetEditor.view.dom.querySelector('.inline-note__mark')?.textContent === '1',
  );

  offsetEditor.destroy();

  // ===== Внутренние ссылки (Правка 6) =====
  const {
    applyPlainLink,
    buildTargetBadge,
    buildTargetLabel,
    createPlainLink,
    internalHref,
    linkToMarkAttrs,
  } = await vite.ssrLoadModule('/src/utils/links.js');
  const { annotateText } = await vite.ssrLoadModule('/src/utils/plainText.js');

  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Перейти к тесту' }] }],
  });
  editor.commands.selectAll();
  editor
    .chain()
    .focus()
    .setLink({
      href: '/block/b1?question=q1',
      linkKind: 'internal',
      targetType: 'question',
      targetId: 'q1',
      targetBlockId: 'b1',
      targetLabel: 'Тест → Вопрос 2',
      targetBadge: 'Вопрос',
    })
    .run();

  const internalAnchor = editor.view.dom.querySelector('a[data-link-kind]');
  check(
    'links: внутренняя ссылка помечена в HTML',
    internalAnchor?.getAttribute('data-link-kind') === 'internal' &&
      internalAnchor?.getAttribute('data-target-type') === 'question' &&
      internalAnchor?.getAttribute('data-target-id') === 'q1' &&
      internalAnchor?.getAttribute('data-target-block') === 'b1',
    internalAnchor?.outerHTML,
  );
  check(
    'links: подсказка «Ведёт на …»',
    internalAnchor?.getAttribute('title') === 'Ведёт на: Тест → Вопрос 2',
    internalAnchor?.getAttribute('title'),
  );
  check(
    'links: метка типа цели не попадает в текст ссылки',
    internalAnchor?.getAttribute('data-target-badge') === 'Вопрос' &&
      !internalAnchor?.getAttribute('data-show-type'),
    internalAnchor?.outerHTML,
  );
  check('links: у внутренней ссылки нет target', !internalAnchor?.getAttribute('target'));

  editor.commands.selectAll();
  editor.chain().focus().setLink({ href: 'https://example.com', linkKind: 'external', newTab: true }).run();
  const externalAnchor = editor.view.dom.querySelector('a[data-link-kind]');
  check(
    'links: внешняя ссылка открывается в новой вкладке',
    externalAnchor?.getAttribute('data-link-kind') === 'external' &&
      externalAnchor?.getAttribute('target') === '_blank' &&
      externalAnchor?.getAttribute('rel') === 'noopener noreferrer',
    externalAnchor?.outerHTML,
  );

  const plainLink = createPlainLink({
    kind: 'internal',
    href: '/block/b1?slide=s1',
    field: 'cell',
    ref: '0-0',
    from: 0,
    to: 5,
    word: '  Слово  ',
    targetType: 'slide',
    targetId: 's1',
    targetBlockId: 'b1',
    targetLabel: 'Теория → Слайд 1',
    targetBadge: 'Слайд',
  });
  check(
    'links: ссылка обычного текста нормализуется',
    plainLink?.id?.startsWith('link-') &&
      plainLink.kind === 'internal' &&
      plainLink.word === 'Слово' &&
      plainLink.targetBlockId === 'b1' &&
      plainLink.newTab === false,
    JSON.stringify(plainLink),
  );
  check(
    'links: адрес цели собирается из типа и id',
    internalHref({ targetType: 'memo', targetId: 'm1', targetBlockId: 'b1' }) === '/block/b1?memo=m1' &&
      internalHref({ targetType: 'block', targetId: 'b1', targetBlockId: 'b1' }) === '/block/b1',
  );
  check(
    'links: описание и метка цели',
    buildTargetLabel({ title: 'Тест' }, { index: 1 }, 'question') === 'Тест → Вопрос 2' &&
      buildTargetBadge({ type: 'test' }, 'block') === 'Тест' &&
      buildTargetBadge({ type: 'theory' }, 'slide') === 'Слайд',
  );
  check(
    'links: атрибуты метки Tiptap',
    linkToMarkAttrs(plainLink).linkKind === 'internal' &&
      linkToMarkAttrs(plainLink).targetType === 'slide' &&
      linkToMarkAttrs(plainLink).targetLabel === 'Теория → Слайд 1' &&
      !('showType' in linkToMarkAttrs(plainLink)),
  );

  const sourceText = 'Проверить огнетушитель срочно';
  const wordFrom = sourceText.indexOf('огнетушитель');
  const noteFrom = sourceText.indexOf('срочно');
  const applied = applyPlainLink({
    value: sourceText,
    notes: [
      { id: 'note-a1', text: 'Примечание', field: 'item', ref: '1', from: noteFrom, to: noteFrom + 6, word: 'срочно' },
    ],
    links: [],
    field: 'item',
    ref: '1',
    from: wordFrom,
    to: wordFrom + 'огнетушитель'.length,
    label: 'огнетушитель и кран',
    payload: { kind: 'external', href: 'https://example.com', newTab: true },
  });
  const expectedShift = 'огнетушитель и кран'.length - 'огнетушитель'.length;
  check(
    'links: текст ссылки заменяется, примечание сдвигается',
    applied?.value === 'Проверить огнетушитель и кран срочно' &&
      applied.links[0]?.word === 'огнетушитель и кран' &&
      applied.links[0]?.href === 'https://example.com' &&
      applied.notes[0]?.from === noteFrom + expectedShift,
    JSON.stringify(applied),
  );
  check(
    'links: без выделения ссылка не создаётся',
    applyPlainLink({
      value: 'текст',
      field: 'cell',
      from: 2,
      to: 2,
      payload: { kind: 'external', href: 'https://example.com' },
    }) === null,
  );

  const driftedText = 'Срочно проверить огнетушитель';
  const driftStart = driftedText.indexOf('огнетушитель');
  const driftedLink = {
    id: 'link-drift',
    field: 'item',
    ref: '1',
    from: 0,
    to: 5,
    word: 'огнетушитель',
    kind: 'external',
    href: 'https://example.com',
    newTab: true,
  };
  const drifted = applyPlainLink({
    value: driftedText,
    links: [driftedLink],
    field: 'item',
    ref: '1',
    from: driftedLink.from,
    to: driftedLink.to,
    label: 'огнетушитель и кран',
    payload: { kind: 'external', href: 'https://example.com' },
    editingId: driftedLink.id,
  });
  check(
    'links: изменение ссылки находит слово по сохранённому word',
    drifted?.value === 'Срочно проверить огнетушитель и кран' &&
      drifted.links.length === 1 &&
      drifted.links[0].id === driftedLink.id &&
      drifted.links[0].from === driftStart &&
      drifted.links[0].to === driftedText.length + ' и кран'.length,
    JSON.stringify(drifted),
  );

  const sharedWord = applyPlainLink({
    value: driftedText,
    notes: [
      {
        id: 'note-same',
        text: 'Примечание',
        field: 'item',
        ref: '1',
        from: driftStart,
        to: driftedText.length,
        word: 'огнетушитель',
      },
    ],
    field: 'item',
    ref: '1',
    from: driftStart,
    to: driftedText.length,
    label: 'огнетушитель и кран',
    payload: { kind: 'internal', href: '/block/b1', targetBlockId: 'b1' },
  });
  check(
    'links: примечание на том же слове растягивается вместе со ссылкой',
    sharedWord?.value === 'Срочно проверить огнетушитель и кран' &&
      sharedWord.notes[0]?.from === driftStart &&
      sharedWord.notes[0].to === driftStart + 'огнетушитель и кран'.length,
    JSON.stringify(sharedWord),
  );

  const annotated = annotateText(
    'Срочно проверить огнетушитель',
    [{ id: 'note-l1', text: 'Примечание', field: 'item', ref: '1', from: 0, to: 6, word: 'Срочно' }],
    [
      {
        id: 'link-l1',
        kind: 'external',
        href: 'https://example.com',
        field: 'item',
        ref: '1',
        from: 16,
        to: 28,
        word: 'огнетушитель',
      },
    ],
  );
  check(
    'links: текст делится на примечание и ссылку',
    annotated.length === 3 &&
      annotated[0].note?.id === 'note-l1' &&
      annotated[0].noteEnd === true &&
      annotated[2].link?.id === 'link-l1',
    JSON.stringify(annotated),
  );

  editor.destroy();

  // ===== Реальный рендер TheoryBlock в jsdom =====
  const { createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: TheoryBlock } = await vite.ssrLoadModule('/src/components/editor/TheoryBlock.jsx');
  const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
  const { useContentStore } = await vite.ssrLoadModule('/src/store/contentStore.js');
  const { useUiStore } = await vite.ssrLoadModule('/src/store/uiStore.js');

  useAuthStore.setState({ isEditor: true, isAuthenticated: true, user: { id: 'u1', login: 'admin', role: 'admin' } });
  useUiStore.setState({ uiMode: 'edit' });
  useContentStore.setState({
    // Эффект загрузки не должен ходить в сеть во время проверки
    fetchSlides: async () => [],
    blockId: 'block-1',
    activeSlideId: 'slide-1',
    loading: false,
    loaded: true,
    error: null,
    slides: [
      {
        id: 'slide-1',
        blockId: 'block-1',
        title: 'Введение',
        order: 0,
        contentCount: 3,
        contents: [
          {
            id: 'content-1',
            slideId: 'slide-1',
            type: 'text',
            data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Текст' }] }] },
            dataVersion: 1,
            width: 50,
            order: 0,
          },
          {
            id: 'content-2',
            slideId: 'slide-1',
            type: 'checklist',
            data: { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: 'Пункт', checked: false }] },
            dataVersion: 1,
            width: 50,
            order: 1,
          },
          {
            id: 'content-3',
            slideId: 'slide-1',
            type: 'important',
            // Оформление блока хранится рядом с Tiptap-документом (utils/important.js)
            data: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Важное правило' }] }],
              important: { background: '#DBEAFE', borderColor: '', borderWidth: 1, radius: 10 },
            },
            dataVersion: 1,
            width: 100,
            order: 2,
          },
        ],
      },
    ],
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(createElement(TheoryBlock, { block: { id: 'block-1', type: 'theory', title: 'Теория', contentCount: 3 } }));

  // Tiptap создаётся в эффекте, а в dev-режиме Vite первый рендер идёт с задержкой:
  // ждём появления редактора (до 3 с), иначе проверка ловит ещё не смонтированный DOM.
  const waitFor = async (predicate, timeout = 3000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return predicate();
  };

  await waitFor(() => Boolean(host.querySelector('.tiptap')));

  check('render: панель инструментов в DOM', Boolean(host.querySelector('.toolbar')));
  check('render: кнопка примечания в панели', Boolean(host.querySelector('.toolbar [aria-label="Примечание"]')));
  check('render: три фрагмента контента', host.querySelectorAll('.content-card').length === 3);
  check('render: Tiptap-редактор создан', Boolean(host.querySelector('.tiptap')));
  check('render: содержание и навигация', Boolean(host.querySelector('.slide-list')) && Boolean(host.querySelector('.slide-nav')));
  check('render: редактор чек-листа', Boolean(host.querySelector('.checklist-editor')));
  check('render: нет ошибок в разметке', host.querySelectorAll('.alert--error').length === 0);

  // «Плюсик» последнего ряда вставлял фрагмент туда же, куда нижний (в конец):
  // два значка подряд открывали меню и делали одно и то же. У последнего ряда
  // своего «плюсика» теперь нет — остаётся один нижний.
  const rowCount = host.querySelectorAll('.slide-row').length;
  const rowAdderCount = host.querySelectorAll('.slide-row > .content-plus').length;
  check(
    'render: «плюсик» только у рядов, за которыми есть продолжение',
    rowAdderCount === rowCount - 1 &&
      host.querySelectorAll('.slide-row--add').length === rowAdderCount &&
      host.querySelectorAll('.content-plus--row').length === 1,
  );

  // «Плюсик» добавления — контролируемая панель: после выбора типа она
  // закрывается (раньше это был <details>, и меню «залипало» открытым).
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  // добавление не должно ходить в сеть — подменяем действие стора
  useContentStore.setState({
    addContent: async () => ({ ok: true, content: { id: 'content-new', type: 'text' } }),
  });

  const bottomAdder = host.querySelector('.content-plus--row');
  const bottomTrigger = bottomAdder?.querySelector('.content-plus__trigger');
  const bottomPanel = bottomAdder?.querySelector('.content-plus__panel');

  bottomTrigger?.click();
  await tick();
  const menuOpened = bottomPanel?.hidden === false && bottomTrigger?.getAttribute('aria-expanded') === 'true';

  bottomAdder?.querySelector('.content-types__item')?.click();
  await tick();
  const menuClosed = bottomPanel?.hidden === true && bottomTrigger?.getAttribute('aria-expanded') === 'false';

  check('render: меню «плюсика» закрывается после выбора типа', menuOpened && menuClosed);

  // Клик мимо и Esc тоже закрывают меню
  bottomTrigger?.click();
  await tick();
  const menuReopened = bottomPanel?.hidden === false;

  document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  await tick();
  const closedByOutsideClick = bottomPanel?.hidden === true;

  bottomTrigger?.click();
  await tick();
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  const closedByEscape = bottomPanel?.hidden === true;

  check(
    'render: меню «плюсика» закрывается по клику мимо и Esc',
    menuReopened && closedByOutsideClick && closedByEscape,
  );

  // «Важное»: блок с рамкой и настраиваемым фоном. Цвет применяется сразу,
  // а сохраняется вместе с текстом документа (data.important) — без отдельного
  // запроса и без потери несохранённого текста.
  const importantBlock = host.querySelector('.content-important--edit');
  const importantCard = importantBlock?.closest('.content-card');
  check(
    'render: «Важное» — блок с рамкой вместо подложки карточки',
    Boolean(importantBlock) &&
      importantBlock.style.borderWidth === '1px' &&
      importantBlock.style.borderRadius === '10px' &&
      importantBlock.style.backgroundColor === 'rgb(219, 234, 254)' &&
      !importantCard?.classList.contains('content-card--important'),
    importantBlock?.getAttribute('style') ?? 'блок не найден',
  );

  const { IMPORTANT_PALETTE } = await vite.ssrLoadModule('/src/utils/important.js');
  check(
    'render: палитра цветов, свой цвет и рамка в редакторе',
    host.querySelectorAll('.important-palette__swatch').length === IMPORTANT_PALETTE.length &&
      Boolean(host.querySelector('input[aria-label="Свой цвет блока"]')) &&
      Boolean(host.querySelector('input[aria-label="Цвет рамки блока"]')) &&
      Boolean(host.querySelector('select[aria-label="Толщина рамки блока"]')) &&
      Boolean(host.querySelector('select[aria-label="Скругление углов блока"]')),
  );

  let savedImportant = null;
  useContentStore.setState({
    updateContent: async (slideId, contentId, patch) => {
      savedImportant = { slideId, contentId, patch };
      return { ok: true, content: null };
    },
  });

  const yellowSwatch = host.querySelector('.important-palette__swatch[aria-label="Цвет блока: Жёлтый"]');
  yellowSwatch?.click();
  await tick();

  check(
    'render: цвет блока применяется сразу',
    importantBlock?.style.backgroundColor === 'rgb(254, 243, 199)' &&
      yellowSwatch?.getAttribute('aria-pressed') === 'true',
    importantBlock?.getAttribute('style') ?? 'блок не найден',
  );

  // Автосохранение ждёт 700 мс — столько же, сколько в useAutoSave
  await new Promise((resolve) => setTimeout(resolve, 900));

  check(
    'render: оформление «Важного» сохраняется вместе с документом',
    savedImportant?.contentId === 'content-3' &&
      savedImportant?.patch?.data?.type === 'doc' &&
      savedImportant?.patch?.data?.content?.[0]?.content?.[0]?.text === 'Важное правило' &&
      savedImportant?.patch?.data?.important?.background === '#FEF3C7' &&
      savedImportant?.patch?.data?.important?.borderWidth === 1 &&
      savedImportant?.patch?.data?.important?.radius === 10,
    JSON.stringify(savedImportant?.patch?.data?.important ?? null),
  );

  root.unmount();
} finally {
  await vite.close();
}

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

await writeFile(
  fileURLToPath(new URL('../editor-check.json', import.meta.url)),
  JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2),
  'utf8',
);

process.exitCode = failed.length ? 1 : 0;
