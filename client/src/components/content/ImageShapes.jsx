/**
 * Рамки выделения поверх картинки (правка «ИЗОБРАЖЕНИЕ», часть 2).
 *
 * Фигура рисуется в SVG с системой координат 0–100 и preserveAspectRatio="none":
 * прямоугольник, круг, треугольник и стрелка занимают всю рамку, поэтому размер
 * и положение задаются в процентах от картинки, а толщина контура остаётся
 * пиксельной (vector-effect: non-scaling-stroke).
 *
 * Компонент общий для просмотра/печати (ContentRenderer) и редактора
 * (ImageEditor): редактор добавляет вокруг фигуры ручки размера и поворота.
 */

import { shapeBoxStyle } from '../../utils/image.js';

/** Геометрия фигуры в координатах 0–100. */
function ShapeFigure({ type }) {
  const common = { vectorEffect: 'non-scaling-stroke' };

  switch (type) {
    case 'ellipse':
      return <ellipse cx="50" cy="50" rx="50" ry="50" {...common} />;
    case 'triangle':
      return <polygon points="50,0 100,100 0,100" {...common} />;
    case 'arrow':
      // Стрелка слева направо: древко и наконечник одной фигурой
      return <polygon points="0,50 66,50 66,22 100,50 66,78 66,50" {...common} />;
    default:
      return <rect x="0" y="0" width="100" height="100" {...common} />;
  }
}

/** Одна рамка выделения: цвет, заливка, контур и поворот из данных. */
export function ImageShape({ shape, className = '', children, ...props }) {
  return (
    <div
      className={['image-shape', className].filter(Boolean).join(' ')}
      style={shapeBoxStyle(shape)}
      data-shape-id={shape.id}
      data-shape-type={shape.type}
      {...props}
    >
      <svg
        className="image-shape__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <g
          fill={shape.color}
          fillOpacity={shape.fill / 100}
          stroke={shape.color}
          strokeWidth={shape.stroke}
          strokeLinejoin="round"
        >
          <ShapeFigure type={shape.type} />
        </g>
      </svg>
      {children}
    </div>
  );
}

/** Все рамки картинки — в просмотре и печати (без интерактива). */
export default function ImageShapes({ shapes }) {
  if (!shapes?.length) return null;

  return (
    <div className="content-image__shapes">
      {shapes.map((shape) => (
        <ImageShape key={shape.id} shape={shape} />
      ))}
    </div>
  );
}
