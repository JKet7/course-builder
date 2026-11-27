import { useEffect, useRef, useState } from 'react';
import EditorField, { EditorActions } from './EditorField.jsx';
import RichInput from './RichInput.jsx';
import Icon from '../../ui/Icon.jsx';
import Modal from '../../ui/Modal.jsx';
import { ImageShape } from '../ImageShapes.jsx';
import { IMAGE_MIME_TYPES, uploadImage } from '../../../api/files.js';
import { useThemeStore } from '../../../store/themeStore.js';
import { IMAGE_ALIGNS, normalizeContentData } from '../../../utils/helpers.js';
import { collectPlainLinks } from '../../../utils/links.js';
import {
  NOTE_MAX_LENGTH,
  collectPlainNotes,
  normalizeNoteText,
  plainNoteNumbers,
} from '../../../utils/notes.js';
import { DEFAULT_THEME_COLORS } from '../../../utils/themes.js';
import {
  IMAGE_MARKERS_LIMIT,
  IMAGE_SHAPE_DEFAULT_COLOR,
  IMAGE_SHAPE_FILL_MAX,
  IMAGE_SHAPE_ICONS,
  IMAGE_SHAPE_LABELS,
  IMAGE_SHAPE_MIN_SIZE,
  IMAGE_SHAPE_STROKE_MAX,
  IMAGE_SHAPE_SYSTEM_COLORS,
  IMAGE_SHAPE_TYPES,
  IMAGE_SHAPES_LIMIT,
  IMAGE_WIDTH_MAX,
  IMAGE_WIDTH_MIN,
  addImageMarker,
  addImageShape,
  clampImageWidth,
  collectImageMarkers,
  collectImageShapes,
  createImageMarker,
  createImageShape,
  cropImageStyle,
  imageFrameRatio,
  normalizeAspect,
  normalizeCrop,
  normalizeShape,
  rectFromPoints,
  removeImageMarker,
  removeImageShape,
  setImageMarkerText,
  shapeTitle,
  updateImageShape,
} from '../../../utils/image.js';

/** Ручки изменения размера: четыре угла и четыре стороны. */
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Углы рамки обрезки. */
const CROP_HANDLES = ['nw', 'ne', 'sw', 'se'];

/** Углы рамки выделения: за них меняется размер фигуры. */
const SHAPE_HANDLES = ['nw', 'ne', 'sw', 'se'];

/** Иконки кнопок выравнивания. */
const ALIGN_ICONS = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' };

/**
 * Редактор картинки (правки «ИЗОБРАЖЕНИЕ», части 1 и 2).
 *
 * Источник: кнопка «Выбрать», drag&drop в пунктирную рамку и вставка из буфера
 * (Ctrl+V — скриншот или картинка, скопированная из документа).
 * Размер: картинка тянется за ручки по углам и сторонам, «Сохранять пропорции»
 * отключается галочкой (тогда ширина и высота меняются отдельно), «Обрезать»
 * открывает окно обрезки. Выравнивание — три кнопки; при ширине 100 % оно
 * не влияет на вид, поэтому редактор об этом подсказывает.
 *
 * Маркеры — интерактивные точки: клик по картинке создаёт маркер в точке клика,
 * клик по маркеру открывает окно «Маркер №X» с текстом и кнопками «Сохранить»
 * и «✕ Удалить». Под превью — список маркеров (первые 50 символов, крестик для
 * удаления, «Добавить маркер» — точка в центре картинки).
 *
 * Рамки выделения (часть 2) — цветные фигуры поверх картинки. «Добавить рамку»
 * открывает меню фигур (прямоугольник, круг, треугольник, стрелка): после выбора
 * фигура рисуется мышью прямо на картинке. Рамка выделяется кликом, тянется за
 * центр, меняет размер за углы и поворачивается за кружок над верхней стороной;
 * Delete удаляет выбранную рамку, Esc отменяет рисование. Цвет — палитры «Цвета
 * темы» и «Цвета системы», заливка 0–100 %, контур 0–4 px.
 *
 * В данных маркер — примечание data.notes с field = 'marker' и координатами x/y,
 * поэтому номера сквозные по слайду, а справка о блоке показывает маркеры
 * вместе с остальными примечаниями. Рамки хранятся отдельно — в data.shapes.
 */
export default function ImageEditor({ content, onChange, noteOffset = 0 }) {
  const [data, setData] = useState(() => normalizeContentData('image', content.data));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragging, setDragging] = useState(false);
  // Натуральные пропорции загруженной картинки: высота / ширина
  const [natural, setNatural] = useState(null);
  // Живой предпросмотр перетаскивания: в данные пишем один раз, на отпускании мыши
  const [resize, setResize] = useState(null);
  const [markerDraft, setMarkerDraft] = useState(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [widthInput, setWidthInput] = useState(() => String(clampImageWidth(content.data?.width)));
  // Рамки выделения: выбранная фигура, режим рисования и живой предпросмотр
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [drawType, setDrawType] = useState(null);
  const [drawRect, setDrawRect] = useState(null);
  const [shapeDraft, setShapeDraft] = useState(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  const inputRef = useRef(null);
  const columnRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  // Клик после рисования рамки не должен добавлять маркер
  const suppressClickRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const hasImage = Boolean(data.url);

  // Примечание и ссылка в подписи (Правки 5–6): номер примечания — номер слайда
  const notes = collectPlainNotes(data);
  const links = collectPlainLinks(data);
  const numberById = plainNoteNumbers(data, noteOffset);
  const markers = collectImageMarkers(data);
  const shapes = collectImageShapes(data);
  const selectedShape = shapes.find((shape) => shape.id === selectedShapeId) ?? null;

  // Палитра «Цвета темы» — из активной темы (как в тулбаре редактора текста)
  const themeColors = useThemeStore(
    (state) => state.themes.find((theme) => theme.id === state.activeThemeId)?.colors,
  );
  const colors = themeColors ?? DEFAULT_THEME_COLORS;
  const palette = colors.themeColors?.length ? colors.themeColors : DEFAULT_THEME_COLORS.themeColors;

  const width = resize?.width ?? clampImageWidth(data.width);
  const ratio = imageFrameRatio(
    { aspect: resize ? resize.aspect : data.aspect, crop: data.crop },
    natural,
  );
  const cropStyle = ratio ? cropImageStyle(data.crop) : null;

  useEffect(() => {
    setWidthInput(String(width));
  }, [width]);

  const update = (patch) => {
    const next = { ...dataRef.current, ...patch };
    setData(next);
    onChange(next);
  };

  const handleFile = async (file) => {
    if (!file || uploading) return;

    setUploading(true);
    setUploadError(null);

    const result = await uploadImage(file);
    setUploading(false);

    if (!result.ok) {
      setUploadError(result.message);
      return;
    }

    // Новая картинка — без обрезки и свободных пропорций
    update({ url: result.file.url, fileId: result.file.id, crop: null, aspect: null });
  };

  const pickFile = () => inputRef.current?.click();

  // Ctrl+V: картинка из буфера обмена (скриншот или копия из документа)
  const fileHandlerRef = useRef(handleFile);
  fileHandlerRef.current = handleFile;

  useEffect(() => {
    const handlePaste = (event) => {
      const item = Array.from(event.clipboardData?.items ?? []).find(
        (entry) => entry.kind === 'file' && entry.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (!file) return;

      event.preventDefault();
      fileHandlerRef.current?.(file);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Ручки размера: ширина в процентах колонки, при свободных пропорциях — ещё и высота
  const startResize = (direction) => (event) => {
    if (!canvasRef.current) return;

    event.preventDefault();
    event.stopPropagation();

    const box = canvasRef.current.getBoundingClientRect();
    const columnWidth = columnRef.current?.getBoundingClientRect().width || box.width || 1;
    const locked = dataRef.current.lockAspect !== false;
    const dirX = direction.includes('e') ? 1 : direction.includes('w') ? -1 : 0;
    const dirY = direction.includes('s') ? 1 : direction.includes('n') ? -1 : 0;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = box.width;
    const startHeight = box.height;
    let draft = { width: clampImageWidth(dataRef.current.width), aspect: null };

    const handleMove = (moveEvent) => {
      const widthPx = Math.max(40, startWidth + dirX * (moveEvent.clientX - startX));
      const nextWidth = clampImageWidth((widthPx / columnWidth) * 100);
      const nextAspect =
        locked || dirY === 0 || startHeight === 0
          ? null
          : normalizeAspect(Math.max(30, startHeight + dirY * (moveEvent.clientY - startY)) / widthPx);

      draft = { width: nextWidth, aspect: locked ? null : nextAspect };
      setResize(draft);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setResize(null);
      update(locked ? { width: draft.width } : { width: draft.width, aspect: draft.aspect });
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };
  // Маркеры: клик по картинке — новая точка, клик по точке — правка текста
  const openMarker = (marker) => setMarkerDraft({ ...marker });

  const addMarkerAt = (x, y) => {
    if (markers.length >= IMAGE_MARKERS_LIMIT) return;
    setMarkerDraft({ ...createImageMarker({ x, y }), isNew: true });
  };

  const handleFrameClick = (event) => {
    // Клик после рисования рамки или в режиме рисования маркер не создаёт
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    setSelectedShapeId(null);
    if (drawType) return;
    if (event.target.closest?.('.content-image__marker')) return;
    if (event.target.closest?.('.image-shape')) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    addMarkerAt(
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100,
    );
  };

  const saveMarker = () => {
    if (!markerDraft) return;

    const { isNew, ...marker } = markerDraft;
    const text = normalizeNoteText(markerDraft.text);
    // Маркер без текста не сохраняем: пояснять нечего
    if (!text) {
      setMarkerDraft(null);
      return;
    }

    update({
      notes: isNew
        ? addImageMarker(dataRef.current.notes, { ...marker, text })
        : setImageMarkerText(dataRef.current.notes, markerDraft.id, text),
    });
    setMarkerDraft(null);
  };

  const deleteMarker = () => {
    if (!markerDraft) return;
    update({ notes: removeImageMarker(dataRef.current.notes, markerDraft.id) });
    setMarkerDraft(null);
  };

  const removeMarker = (markerId) => update({ notes: removeImageMarker(dataRef.current.notes, markerId) });

  /* ------------------------------------------- рамки выделения (часть 2) */

  const frameBox = () => frameRef.current?.getBoundingClientRect() ?? null;

  /** Точка мыши в процентах от видимой области картинки. */
  const pointInPercent = (box, event) => ({
    x: Math.min(100, Math.max(0, ((event.clientX - box.left) / (box.width || 1)) * 100)),
    y: Math.min(100, Math.max(0, ((event.clientY - box.top) / (box.height || 1)) * 100)),
  });

  /** Оформление выбранной рамки: цвет, заливка, контур, поворот. */
  const changeShape = (patch) => {
    if (!selectedShapeId) return;
    update({ shapes: updateImageShape(collectImageShapes(dataRef.current), selectedShapeId, patch) });
  };

  const deleteShape = (shapeId) => {
    update({ shapes: removeImageShape(collectImageShapes(dataRef.current), shapeId) });
    setShapeDraft(null);
    setSelectedShapeId((current) => (current === shapeId ? null : current));
  };

  // Выбрали фигуру в меню — дальше рисуем её мышью на картинке
  const startDrawing = (type) => {
    setDrawType(type);
    setShapeMenuOpen(false);
    setSelectedShapeId(null);
  };

  const handleFramePointerDown = (event) => {
    const box = frameBox();
    if (!box || !drawType) return;

    event.preventDefault();
    const start = pointInPercent(box, event);
    let rect = { x: start.x, y: start.y, w: 0, h: 0 };
    setDrawRect(rect);

    const handleMove = (moveEvent) => {
      rect = rectFromPoints(start, pointInPercent(box, moveEvent));
      setDrawRect(rect);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setDrawRect(null);
      setDrawType(null);
      // Клик, завершивший рисование, не должен добавлять ещё и маркер
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      if (rect.w < IMAGE_SHAPE_MIN_SIZE || rect.h < IMAGE_SHAPE_MIN_SIZE) return;

      const shape = createImageShape({ type: drawType, ...rect });
      update({ shapes: addImageShape(collectImageShapes(dataRef.current), shape) });
      setSelectedShapeId(shape.id);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  // Рамка: перетаскивание за центр, размер за углы и поворот за кружок
  const startShapeDrag = (shape, mode) => (event) => {
    const box = frameBox();
    if (!box) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedShapeId(shape.id);

    const start = { ...shape };
    const startX = event.clientX;
    const startY = event.clientY;
    const boxWidth = box.width || 1;
    const boxHeight = box.height || 1;
    const rad = (start.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const centerX = box.left + ((start.x + start.w / 2) / 100) * boxWidth;
    const centerY = box.top + ((start.y + start.h / 2) / 100) * boxHeight;
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    let draft = start;

    const handleMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startX) / boxWidth) * 100;
      const dy = ((moveEvent.clientY - startY) / boxHeight) * 100;

      if (mode === 'move') {
        draft = { ...start, x: start.x + dx, y: start.y + dy };
      } else if (mode === 'rotate') {
        const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
        draft = { ...start, rotation: start.rotation + ((angle - startAngle) * 180) / Math.PI };
      } else {
        // Размер: движение мыши переводим в оси самой фигуры — она может быть повёрнута
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;
        const dirX = mode.includes('e') ? 1 : mode.includes('w') ? -1 : 0;
        const dirY = mode.includes('s') ? 1 : mode.includes('n') ? -1 : 0;
        const nextW = dirX ? Math.max(IMAGE_SHAPE_MIN_SIZE, start.w + dirX * localX) : start.w;
        const nextH = dirY ? Math.max(IMAGE_SHAPE_MIN_SIZE, start.h + dirY * localY) : start.h;
        // Якорь — противоположный угол: он остаётся на месте и у повёрнутой фигуры
        const anchorX = dirX === 1 ? -1 : 1;
        const anchorY = dirY === 1 ? -1 : 1;
        const shiftX = (anchorX * (start.w - nextW)) / 2;
        const shiftY = (anchorY * (start.h - nextH)) / 2;

        draft = {
          ...start,
          w: nextW,
          h: nextH,
          x: start.x + (start.w - nextW) / 2 + (shiftX * cos - shiftY * sin),
          y: start.y + (start.h - nextH) / 2 + (shiftX * sin + shiftY * cos),
        };
      }

      draft = normalizeShape(draft, start.id);
      setShapeDraft(draft);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setShapeDraft(null);
      update({
        shapes: updateImageShape(collectImageShapes(dataRef.current), start.id, {
          x: draft.x,
          y: draft.y,
          w: draft.w,
          h: draft.h,
          rotation: draft.rotation,
        }),
      });
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  // Delete удаляет выбранную рамку, Esc отменяет рисование
  useEffect(() => {
    if (!selectedShapeId && !drawType) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && drawType) {
        setDrawType(null);
        setDrawRect(null);
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!selectedShapeId) return;

      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      event.preventDefault();
      deleteShape(selectedShapeId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShapeId, drawType]);

  // Меню фигур закрывается кликом мимо него
  useEffect(() => {
    if (!shapeMenuOpen) return undefined;

    const handlePointerDown = () => setShapeMenuOpen(false);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [shapeMenuOpen]);

  // «Сохранять пропорции»: включили — возвращаем натуральные пропорции картинки
  const toggleLockAspect = () => update({ lockAspect: dataRef.current.lockAspect === false, aspect: null });

  const changeWidthInput = (value) => {
    setWidthInput(value);
    const next = Number(value);
    if (Number.isFinite(next) && next >= IMAGE_WIDTH_MIN && next <= IMAGE_WIDTH_MAX) update({ width: next });
  };

  const commitWidthInput = () => {
    const next = clampImageWidth(widthInput);
    setWidthInput(String(next));
    update({ width: next });
  };

  const dropProps = {
    onDragOver: (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      handleFile(event.dataTransfer?.files?.[0]);
    },
  };

  return (
    <div className="content-editor-form">
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_MIME_TYPES.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {hasImage ? (
        <>
          <div
            className={['image-dropzone', 'image-dropzone--editor', dragging ? 'is-dragging' : '']
              .filter(Boolean)
              .join(' ')}
            {...dropProps}
          >
            <div className="image-editor__stage">
              <div className="image-editor__column" ref={columnRef}>
                <div
                  className="image-editor__canvas"
                  ref={canvasRef}
                  style={{
                    width: `${width}%`,
                    marginLeft: data.align === 'right' ? 'auto' : undefined,
                    marginRight: data.align === 'left' ? 'auto' : undefined,
                    ...(ratio ? { aspectRatio: String(ratio) } : {}),
                  }}
                >
                  <div
                    className="image-editor__frame"
                    ref={frameRef}
                    // Высоту задаёт сама рамка (как в просмотре): при обрезке картинка
                    // позиционируется абсолютно и не участвует в потоке, поэтому без
                    // aspect-ratio рамка схлопывается и вместо фото виден серый фон.
                    style={ratio ? { aspectRatio: String(ratio) } : undefined}
                    onClick={handleFrameClick}
                    onPointerDown={handleFramePointerDown}
                  >
                    <img
                      className="image-editor__image"
                      src={data.url}
                      alt={data.alt || ''}
                      draggable={false}
                      style={cropStyle ?? undefined}
                      onLoad={(event) => {
                        const img = event.currentTarget;
                        if (img.naturalWidth > 0) setNatural(img.naturalHeight / img.naturalWidth);
                      }}
                    />

                    {markers.map((marker) => (
                      <button
                        key={marker.id}
                        type="button"
                        className="content-image__marker"
                        style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                        aria-label={`Маркер ${numberById.get(marker.id) ?? ''}: ${marker.text}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          openMarker(marker);
                        }}
                      >
                        <span className="content-image__marker-number">{numberById.get(marker.id)}</span>
                      </button>
                    ))}
                  </div>

                  {/* Рамки выделения: фигуры поверх картинки */}
                  <div className="image-editor__shapes">
                    {shapes.map((shape) => {
                      const current = shapeDraft?.id === shape.id ? shapeDraft : shape;
                      const selected = shape.id === selectedShapeId;

                      return (
                        <ImageShape
                          key={shape.id}
                          shape={current}
                          className={selected ? 'is-selected' : ''}
                          role="button"
                          tabIndex={0}
                          aria-label={`Рамка выделения: ${shapeTitle(shape, colors)}`}
                          aria-pressed={selected}
                          onPointerDown={startShapeDrag(current, 'move')}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedShapeId(shape.id);
                            }
                          }}
                        >
                          {selected && (
                            <>
                              {SHAPE_HANDLES.map((corner) => (
                                <span
                                  key={corner}
                                  className={`image-shape__handle image-shape__handle--${corner}`}
                                  role="presentation"
                                  onPointerDown={startShapeDrag(current, corner)}
                                />
                              ))}
                              <span
                                className="image-shape__rotate"
                                role="presentation"
                                title="Поворот рамки"
                                onPointerDown={startShapeDrag(current, 'rotate')}
                              >
                                <span className="image-shape__rotate-dot" />
                              </span>
                            </>
                          )}
                        </ImageShape>
                      );
                    })}

                    {drawRect && drawType && (
                      <ImageShape
                        shape={{
                          id: 'shape-draft',
                          type: drawType,
                          rotation: 0,
                          fill: 10,
                          stroke: 2,
                          color: IMAGE_SHAPE_DEFAULT_COLOR,
                          ...drawRect,
                        }}
                        className="is-draft"
                      />
                    )}
                  </div>

                  {RESIZE_HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className={`image-editor__handle image-editor__handle--${handle}`}
                      role="presentation"
                      onPointerDown={startResize(handle)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="image-editor__hint">
              {drawType
                ? `Зажмите кнопку мыши на картинке и нарисуйте фигуру «${IMAGE_SHAPE_LABELS[drawType]}». Esc — отмена.`
                : 'Клик по картинке — новый маркер в точке клика; текст маркера правится по клику на нём.'}
            </p>

            <EditorActions>
              <button type="button" className="btn btn--secondary btn--sm" onClick={pickFile} disabled={uploading}>
                <Icon
                  name={uploading ? 'loader' : 'upload'}
                  size={14}
                  className={uploading ? 'icon--spin' : undefined}
                />
                {uploading ? 'Загружаем…' : 'Заменить'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setCropOpen(true)}
                disabled={uploading}
              >
                <Icon name="crop" size={14} />
                Обрезать
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  update({ url: '', fileId: null, crop: null, aspect: null, notes: [], shapes: [] });
                  setSelectedShapeId(null);
                  setShapeDraft(null);
                }}
                disabled={uploading}
              >
                <Icon name="trash" size={14} />
                Убрать
              </button>
            </EditorActions>
          </div>
          <div className="content-field-row">
            <EditorField label="Ширина" hint="Или потяните за края картинки">
              <div className="image-editor__width">
                <input
                  className="input input--sm"
                  type="number"
                  min={IMAGE_WIDTH_MIN}
                  max={IMAGE_WIDTH_MAX}
                  step={1}
                  value={widthInput}
                  onChange={(event) => changeWidthInput(event.target.value)}
                  onBlur={commitWidthInput}
                />
                <span className="image-editor__unit">%</span>
              </div>
            </EditorField>

            <EditorField label="Выравнивание" hint={width >= 100 ? 'При ширине 100 % не влияет' : undefined}>
              <div className="image-editor__align" role="group" aria-label="Выравнивание картинки">
                {IMAGE_ALIGNS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`icon-btn${data.align === item.value ? ' is-active' : ''}`}
                    aria-pressed={data.align === item.value}
                    title={item.label}
                    onClick={() => update({ align: item.value })}
                  >
                    <Icon name={ALIGN_ICONS[item.value]} size={16} />
                  </button>
                ))}
              </div>
            </EditorField>
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={data.lockAspect !== false} onChange={toggleLockAspect} />
            <span>Сохранять пропорции</span>
          </label>

          <div className="image-markers">
            <div className="image-markers__head">
              <span>Маркеры</span>
              <span className="image-markers__count">{markers.length}</span>
            </div>

            {markers.length > 0 ? (
              <ul className="image-markers__list">
                {markers.map((marker) => (
                  <li key={marker.id} className="image-markers__item">
                    <button type="button" className="image-markers__row" onClick={() => openMarker(marker)}>
                      <span className="image-markers__number">{numberById.get(marker.id)}</span>
                      <span className="image-markers__text">{marker.text.slice(0, 50)}</span>
                    </button>
                    <button
                      type="button"
                      className="image-markers__remove"
                      aria-label={`Удалить маркер ${numberById.get(marker.id) ?? ''}`}
                      onClick={() => removeMarker(marker.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="content-field__hint">Пока пусто: щёлкните по картинке в нужном месте.</p>
            )}

            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => addMarkerAt(50, 50)}
              disabled={markers.length >= IMAGE_MARKERS_LIMIT}
            >
              <Icon name="plus" size={14} />
              Добавить маркер
            </button>
          </div>

          {/* Рамки выделения: фигуры поверх картинки (часть 2) */}
          <div className="image-shapes">
            <div className="image-shapes__head">
              <span>Рамки выделения</span>
              <span className="image-shapes__count">{shapes.length}</span>
            </div>

            {shapes.length > 0 ? (
              <ul className="image-shapes__list">
                {shapes.map((shape) => (
                  <li
                    key={shape.id}
                    className={`image-shapes__item${shape.id === selectedShapeId ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="image-shapes__row"
                      aria-pressed={shape.id === selectedShapeId}
                      onClick={() => setSelectedShapeId(shape.id)}
                    >
                      <Icon name={IMAGE_SHAPE_ICONS[shape.type]} size={14} />
                      <span className="image-shapes__title">{shapeTitle(shape, colors)}</span>
                    </button>
                    <button
                      type="button"
                      className="image-shapes__remove"
                      aria-label={`Удалить рамку «${shapeTitle(shape, colors)}»`}
                      onClick={() => deleteShape(shape.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="content-field__hint">Пока пусто: выберите фигуру и нарисуйте её на картинке.</p>
            )}

            <div className="image-shapes__add" onPointerDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-haspopup="menu"
                aria-expanded={shapeMenuOpen}
                onClick={() => setShapeMenuOpen((open) => !open)}
                disabled={shapes.length >= IMAGE_SHAPES_LIMIT}
              >
                <Icon name="plus" size={14} />
                {drawType ? `Рисуем: ${IMAGE_SHAPE_LABELS[drawType]}` : 'Добавить рамку'}
              </button>

              {shapeMenuOpen && (
                <div className="image-shapes__menu" role="menu">
                  {IMAGE_SHAPE_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="menuitem"
                      className="image-shapes__menu-item"
                      onClick={() => startDrawing(type)}
                    >
                      <Icon name={IMAGE_SHAPE_ICONS[type]} size={14} />
                      {IMAGE_SHAPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedShape && (
              <div className="image-shapes__settings">
                <span className="image-shapes__legend">Цвета темы</span>
                <div className="image-shapes__swatches">
                  {palette.map((color) => (
                    <button
                      key={`theme-${color}`}
                      type="button"
                      className={`image-shapes__swatch${
                        selectedShape.color === String(color).toUpperCase() ? ' is-active' : ''
                      }`}
                      style={{ background: color }}
                      aria-label={`Цвет ${color}`}
                      aria-pressed={selectedShape.color === String(color).toUpperCase()}
                      onClick={() => changeShape({ color })}
                    />
                  ))}
                </div>

                <span className="image-shapes__legend">Цвета системы</span>
                <div className="image-shapes__swatches">
                  {IMAGE_SHAPE_SYSTEM_COLORS.map((item) => (
                    <button
                      key={`system-${item.value}`}
                      type="button"
                      className={`image-shapes__swatch${
                        selectedShape.color === item.value ? ' is-active' : ''
                      }`}
                      style={{ background: item.value }}
                      title={item.name}
                      aria-label={`Цвет ${item.name}`}
                      aria-pressed={selectedShape.color === item.value}
                      onClick={() => changeShape({ color: item.value })}
                    />
                  ))}
                </div>

                <label className="image-shapes__range">
                  <span>Заливка</span>
                  <input
                    type="range"
                    min={0}
                    max={IMAGE_SHAPE_FILL_MAX}
                    step={5}
                    value={selectedShape.fill}
                    onChange={(event) => changeShape({ fill: Number(event.target.value) })}
                  />
                  <span className="image-shapes__value">{selectedShape.fill} %</span>
                </label>

                <label className="image-shapes__range">
                  <span>Контур</span>
                  <input
                    type="range"
                    min={0}
                    max={IMAGE_SHAPE_STROKE_MAX}
                    step={1}
                    value={selectedShape.stroke}
                    onChange={(event) => changeShape({ stroke: Number(event.target.value) })}
                  />
                  <span className="image-shapes__value">{selectedShape.stroke} px</span>
                </label>

                <div className="image-shapes__actions">
                  <span className="content-field__hint">
                    Поворот: {selectedShape.rotation}° · Delete — удалить рамку
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => changeShape({ rotation: 0 })}
                  >
                    Сбросить поворот
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          className={['image-dropzone', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
          {...dropProps}
        >
          <button type="button" className="image-dropzone__btn" onClick={pickFile} disabled={uploading}>
            <Icon
              name={uploading ? 'loader' : 'image'}
              size={22}
              className={uploading ? 'icon--spin' : undefined}
            />
            <span>{uploading ? 'Загружаем картинку…' : 'Перетащите файл сюда или нажмите, чтобы выбрать'}</span>
            <span className="content-field__hint">PNG, JPEG, WebP, GIF, SVG — до 5 МБ</span>
          </button>
        </div>
      )}
      {uploadError && <p className="content-field__error">{uploadError}</p>}

      <EditorField label="Ссылка на изображение" hint="Можно вставить готовый адрес вместо загрузки">
        <input
          className="input input--sm"
          type="url"
          value={data.url}
          placeholder="/uploads/… или https://…"
          onChange={(event) => update({ url: event.target.value, fileId: null })}
        />
      </EditorField>

      <EditorField label="Описание для скринридера">
        <input
          className="input input--sm"
          value={data.alt ?? ''}
          placeholder="Что изображено на картинке"
          onChange={(event) => update({ alt: event.target.value })}
        />
      </EditorField>

      <EditorField label="Подпись">
        <RichInput
          className="input input--sm"
          value={data.caption}
          placeholder="Необязательная подпись под картинкой"
          notes={notes}
          links={links}
          numberById={numberById}
          field="caption"
          refId=""
          onNotesChange={(next) => update({ notes: next })}
          onLinksChange={(next) => update({ links: next })}
          onAnnotate={({ value: nextValue, links: nextLinks, notes: nextNotes }) =>
            update({ caption: nextValue, links: nextLinks ?? data.links, notes: nextNotes ?? data.notes })
          }
          onChange={(event) => update({ caption: event.target.value })}
        />
      </EditorField>

      {markerDraft && (
        <Modal
          title={`Маркер №${markerDraft.isNew ? noteOffset + markers.length + 1 : numberById.get(markerDraft.id) ?? '—'}`}
          subtitle="Пояснение появится при наведении на точку или клике по ней"
          onClose={() => setMarkerDraft(null)}
          footer={
            <>
              {!markerDraft.isNew && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={deleteMarker}>
                  ✕ Удалить
                </button>
              )}
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setMarkerDraft(null)}>
                Отмена
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={saveMarker}>
                Сохранить
              </button>
            </>
          }
        >
          <EditorField label="Текст маркера" hint={`До ${NOTE_MAX_LENGTH} символов`}>
            <textarea
              className="input"
              rows={4}
              value={markerDraft.text}
              autoFocus
              onChange={(event) => setMarkerDraft((current) => ({ ...current, text: event.target.value }))}
            />
          </EditorField>
        </Modal>
      )}

      {cropOpen && (
        <ImageCropModal
          url={data.url}
          natural={natural}
          value={data.crop}
          onApply={(crop) => {
            update({ crop });
            setCropOpen(false);
          }}
          onClose={() => setCropOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Окно обрезки: рамку можно перетаскивать за центр, тянуть за углы и сбросить.
 * Результат хранится в долях картинки, поэтому обрезка не зависит от ширины
 * колонки и одинаково выглядит на экране и в печати.
 */
function ImageCropModal({ url, natural, value, onApply, onClose }) {
  const [rect, setRect] = useState(() => normalizeCrop(value) ?? { x: 0, y: 0, w: 1, h: 1 });
  const areaRef = useRef(null);

  const startDrag = (mode) => (event) => {
    const area = areaRef.current;
    if (!area) return;

    event.preventDefault();
    event.stopPropagation();

    const box = area.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...rect };
    const min = 0.05;

    const handleMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / (box.width || 1);
      const dy = (moveEvent.clientY - startY) / (box.height || 1);

      if (mode === 'move') {
        setRect({
          ...start,
          x: Math.min(Math.max(0, start.x + dx), 1 - start.w),
          y: Math.min(Math.max(0, start.y + dy), 1 - start.h),
        });
        return;
      }

      let left = start.x;
      let top = start.y;
      let right = start.x + start.w;
      let bottom = start.y + start.h;

      if (mode.includes('w')) left = Math.min(Math.max(0, start.x + dx), right - min);
      if (mode.includes('n')) top = Math.min(Math.max(0, start.y + dy), bottom - min);
      if (mode.includes('e')) right = Math.max(Math.min(1, start.x + start.w + dx), left + min);
      if (mode.includes('s')) bottom = Math.max(Math.min(1, start.y + start.h + dy), top + min);

      setRect({ x: left, y: top, w: right - left, h: bottom - top });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <Modal
      title="Обрезка картинки"
      subtitle="Выделите нужную область: рамка тянется за центр и углы"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}
          >
            Сбросить
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => onApply(normalizeCrop(rect))}>
            Применить
          </button>
        </>
      }
    >
      <div className="image-crop" ref={areaRef} style={natural ? { aspectRatio: String(1 / natural) } : undefined}>
        <img className="image-crop__img" src={url} alt="" draggable={false} />
        <div
          className="image-crop__rect"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
          onPointerDown={startDrag('move')}
        >
          {CROP_HANDLES.map((corner) => (
            <span
              key={corner}
              className={`image-crop__handle image-crop__handle--${corner}`}
              role="presentation"
              onPointerDown={startDrag(corner)}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
