import ContentGrid from '../content/ContentGrid.jsx';

/**
 * Сетка слайда «Теории».
 *
 * Раскладка, «плюсики», перетаскивание и нумерация примечаний живут в общей
 * ContentGrid: та же сетка используется в карточках глоссария и памятки.
 * Здесь остаётся только подпись пустого слайда.
 */
export default function SlideGrid({ slide, ...props }) {
  return (
    <ContentGrid
      contents={slide?.contents ?? []}
      emptyTitle="Слайд пуст"
      emptyHint="Добавьте первый фрагмент — текст, картинку, видео или таблицу."
      emptyViewHint="На этом слайде пока нет материалов."
      {...props}
    />
  );
}
