import { useAuthStore } from '../../store/authStore.js';

/** Рендерит детей только для admin/editor. */
export default function EditorOnly({ children, fallback = null }) {
  const isEditor = useAuthStore((state) => state.isEditor);
  return isEditor ? children : fallback;
}
