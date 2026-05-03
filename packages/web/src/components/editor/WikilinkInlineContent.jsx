import { createReactInlineContentSpec } from '@blocknote/react';
import { useNavigate } from 'react-router-dom';

/**
 * Custom BlockNote inline content type for [[wikilinks]].
 * Renders as a styled clickable link that navigates to the referenced note.
 */
export const Wikilink = createReactInlineContentSpec(
  {
    type: 'wikilink',
    propSchema: {
      title: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const title = props.inlineContent.props.title;
      const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

      return (
        <a
          href={`/notes/${slug}`}
          onClick={(e) => {
            e.preventDefault();
            // Use window history for SPA navigation since we can't use hooks here
            window.history.pushState({}, '', `/notes/${slug}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          style={{
            color: 'var(--color-primary)',
            textDecoration: 'none',
            background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
            borderRadius: '3px',
            padding: '1px 4px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
          data-wikilink={title}
        >
          {title}
        </a>
      );
    },
    // Serialize to [[Title]] in external HTML
    toExternalHTML: (props) => {
      const title = props.inlineContent.props.title;
      return <span>{`[[${title}]]`}</span>;
    },
  },
);
