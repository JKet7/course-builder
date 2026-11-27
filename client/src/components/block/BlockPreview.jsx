import Icon from '../ui/Icon.jsx';
import BlockBadge from './BlockBadge.jsx';
import { getBlockContentLabel, getBlockIcon } from '../../utils/helpers.js';

/**
 * Превью выбранного блока (правая область страницы курса):
 * обложка на всю площадь, затемнение снизу и текст поверх него.
 * block: { id, type, title, description, coverImage, contentCount }
 */
export default function BlockPreview({ block }) {
  if (!block) {
    return (
      <div className="block-preview block-preview--empty">
        <Icon name="layers" size={40} />
        <p>Выберите блок слева, чтобы увидеть превью.</p>
      </div>
    );
  }

  return (
    <article className="block-preview">
      <div className="block-preview__media">
        {block.coverImage ? (
          <img className="block-preview__image" src={block.coverImage} alt="" />
        ) : (
          <span className="block-preview__stub">
            <Icon name={getBlockIcon(block.type)} size={56} />
          </span>
        )}
      </div>

      <div className="block-preview__overlay">
        <BlockBadge type={block.type} className="block-preview__badge" />

        <h2 className="block-preview__title">{block.title}</h2>

        {block.description && <p className="block-preview__description">{block.description}</p>}

        <span className="block-preview__count">{getBlockContentLabel(block.type, block.contentCount)}</span>
      </div>
    </article>
  );
}

