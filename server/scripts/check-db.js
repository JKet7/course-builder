// Проверка БД после миграции: каскады по FK и unique-индекс Progress.
// Использует встроенный node:sqlite (Node >= 22), внешние зависимости не нужны.
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve('prisma/dev.db');
if (!fs.existsSync(dbPath)) {
  console.error('[check-db] file not found:', dbPath);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const tables = [
  'User',
  'Course',
  'Block',
  'TheorySlide',
  'TheoryContent',
  'TestGroup',
  'TestQuestion',
  'TestOption',
  'TestPair',
  'MemoSlide',
  'MemoCell',
  'GlossaryTerm',
  'Theme',
  'Progress',
  'Comment',
  'File',
  'AuditLog',
];

let problems = 0;

for (const table of tables) {
  const fks = db.prepare(`PRAGMA foreign_key_list('${table}')`).all();
  if (fks.length === 0) {
    console.log(`${table}: no FK`);
    continue;
  }
  for (const fk of fks) {
    const action = `${fk.on_delete}${fk.on_update && fk.on_update !== 'NO ACTION' ? ` / upd: ${fk.on_update}` : ''}`;
    console.log(`${table}.${fk.from} -> ${fk.table}.${fk.to} : onDelete=${action}`);

    const allowed =
      (table === 'User' && fk.from === 'activeThemeId' && fk.on_delete === 'SET NULL') ||
      (table === 'TestQuestion' && fk.from === 'groupId' && fk.on_delete === 'SET NULL') ||
      fk.on_delete === 'CASCADE';
    if (!allowed) {
      problems += 1;
      console.log(`  ! unexpected onDelete for ${table}.${fk.from}`);
    }
  }
}

const progressIndexes = db.prepare("PRAGMA index_list('Progress')").all();
console.log('\nProgress indexes:');
let hasUniqueComposite = false;
for (const idx of progressIndexes) {
  const cols = db.prepare(`PRAGMA index_info('${idx.name}')`).all().map((c) => c.name);
  console.log(`  ${idx.name} unique=${idx.unique} cols=${cols.join(',')}`);
  if (Number(idx.unique) === 1 && cols.length === 2 && cols.includes('userId') && cols.includes('blockId')) {
    hasUniqueComposite = true;
  }
}
if (!hasUniqueComposite) problems += 1;

console.log(hasUniqueComposite ? '\nOK: unique index on Progress(userId, blockId) exists' : '\nFAIL: no unique index on Progress(userId, blockId)');
console.log(problems === 0 ? 'OK: all FK cascades as expected' : `FAIL: ${problems} problem(s)`);
