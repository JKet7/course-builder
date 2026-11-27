import { useEffect } from 'react';
import TestEditor from '../test/TestEditor.jsx';
import TestReader from '../test/TestReader.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { useTestStore } from '../../store/testStore.js';

/**
 * Блок «Тест»: два принципиально разных интерфейса.
 *
 * Редактор (uiMode === 'edit', только для автора) — вертикальный список
 * карточек вопросов в стиле Google Forms: настройки, разделы, ветвление,
 * перетаскивание и правая панель выбранного вопроса.
 *
 * Читатель — прохождение теста; редакторских панелей там нет.
 */
export default function TestBlock({ block }) {
  const isEditor = useAuthStore((state) => state.isEditor);
  const uiMode = useUiStore((state) => state.uiMode);
  const canEdit = isEditor && uiMode === 'edit';

  const fetchAll = useTestStore((state) => state.fetchAll);

  useEffect(() => {
    fetchAll(block.id);
  }, [block.id, fetchAll]);

  return canEdit ? <TestEditor block={block} /> : <TestReader block={block} />;
}
