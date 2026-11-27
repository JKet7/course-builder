import { useRef, useState } from 'react';
import EditorField, { EditorActions } from './EditorField.jsx';
import RichInput from './RichInput.jsx';
import Icon from '../../ui/Icon.jsx';
import { MAX_VIDEO_SIZE, VIDEO_MIME_TYPES, uploadVideo } from '../../../api/files.js';
import { VIDEO_ALIGNS, getVideoEmbed, normalizeContentData } from '../../../utils/helpers.js';
import { collectPlainLinks } from '../../../utils/links.js';
import { collectPlainNotes, plainNoteNumbers } from '../../../utils/notes.js';

const VIDEO_TITLE = {
  youtube: 'Видео YouTube',
  vimeo: 'Видео Vimeo',
  file: 'Видеофайл',
};

/**
 * Редактор видео: загрузка файла (drag&drop или выбор), ссылка YouTube/Vimeo
 * или прямой файл, подпись. Плеер показывается сразу, чтобы редактор видел результат.
 */
export default function VideoEditor({ content, onChange, noteOffset = 0 }) {
  const [data, setData] = useState(() => normalizeContentData('video', content.data));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const embed = getVideoEmbed(data.url);
  const hasUrl = Boolean(String(data.url).trim());
  // Файл, загруженный на наш сервер (/uploads/...), показываем прямо в дропзоне
  const isLocalFile = Boolean(embed?.provider === 'file' && String(data.url).startsWith('/uploads/'));

  // Примечание и ссылка в подписи (Правки 5–6): номер примечания — номер слайда
  const notes = collectPlainNotes(data);
  const links = collectPlainLinks(data);
  const numberById = plainNoteNumbers(data, noteOffset);

  const update = (patch) => {
    const next = { ...data, ...patch };
    setData(next);
    onChange(next);
  };

  const handleFile = async (file) => {
    if (!file || uploading) return;

    setUploading(true);
    setUploadError(null);

    const result = await uploadVideo(file);
    setUploading(false);

    if (!result.ok) {
      setUploadError(result.message);
      return;
    }

    update({ url: result.file.url });
  };

  const pickFile = () => inputRef.current?.click();

  return (
    <div className="content-editor-form">
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_MIME_TYPES.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <div
        className={['video-dropzone', dragging ? 'is-dragging' : '', isLocalFile ? 'has-file' : ''].filter(Boolean).join(' ')}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          handleFile(event.dataTransfer?.files?.[0]);
        }}
      >
        {isLocalFile ? (
          <>
            <video className="video-player" src={data.url} controls preload="metadata" />
            <EditorActions>
              <button type="button" className="btn btn--secondary btn--sm" onClick={pickFile} disabled={uploading}>
                <Icon name={uploading ? 'loader' : 'upload'} size={14} className={uploading ? 'icon--spin' : undefined} />
                {uploading ? 'Загружаем…' : 'Заменить видео'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => update({ url: '' })}
                disabled={uploading}
              >
                <Icon name="trash" size={14} />
                Убрать
              </button>
            </EditorActions>
          </>
        ) : (
          <button type="button" className="video-dropzone__btn" onClick={pickFile} disabled={uploading}>
            <Icon name={uploading ? 'loader' : 'video'} size={22} className={uploading ? 'icon--spin' : undefined} />
            <span>{uploading ? 'Загружаем видео…' : 'Перетащите видеофайл сюда или нажмите, чтобы выбрать'}</span>
            <span className="content-field__hint">MP4, WebM, OGG — до {MAX_VIDEO_SIZE / (1024 * 1024)} МБ</span>
          </button>
        )}
      </div>

      {uploadError && <p className="content-field__error">{uploadError}</p>}

      <EditorField
        label="Ссылка на видео"
        hint="Можно вставить ссылку YouTube/Vimeo или прямой файл .mp4/.webm/.ogg"
        error={hasUrl && !embed ? 'Не удалось распознать ссылку — поддерживаются YouTube, Vimeo и прямые файлы' : null}
      >
        <input
          className="input input--sm"
          type="url"
          value={data.url}
          placeholder="https://www.youtube.com/watch?v=…"
          onChange={(event) => update({ url: event.target.value })}
        />
      </EditorField>

      <EditorField
        label="Выравнивание в колонке"
        hint="Ширина колонки — в шапке карточки: 33, 50, 66 или 100 %. Плеер занимает всю колонку, выравнивание прижимает содержимое внутри неё"
      >
        <select
          className="tool-select tool-select--sm"
          value={data.align}
          onChange={(event) => update({ align: event.target.value })}
        >
          {VIDEO_ALIGNS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </EditorField>

      {embed && embed.provider === 'file' && !isLocalFile && (
        <video className="video-player" src={embed.embedUrl} controls preload="metadata" />
      )}

      {embed && embed.provider !== 'file' && (
        <div className="video-embed">
          <iframe
            src={embed.embedUrl}
            title={VIDEO_TITLE[embed.provider] ?? 'Видео'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {embed && (
        <p className="content-field__hint">
          <Icon name="video" size={12} /> {VIDEO_TITLE[embed.provider]}
        </p>
      )}

      <EditorField label="Подпись">
        <RichInput
          className="input input--sm"
          value={data.caption}
          placeholder="О чём видео"
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
    </div>
  );
}
