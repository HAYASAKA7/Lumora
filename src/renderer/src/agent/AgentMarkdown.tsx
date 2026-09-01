import { memo, useMemo, type ReactNode } from 'react';
import Markdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AgentMarkdownProps {
  children: string;
  onOpenLink(url: string): void;
}

const safeMarkdownUrl: UrlTransform = (url, key) => {
  if (key !== 'href') return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
};

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  onOpenLink
}: AgentMarkdownProps): ReactNode {
  const components = useMemo<Components>(() => ({
    a({ children: linkChildren, href, node: _node, ...props }) {
      if (href === undefined || href === '') return <span>{linkChildren}</span>;
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(href);
          }}
        >
          {linkChildren}
        </a>
      );
    },
    img({ alt }) {
      return alt === undefined || alt === ''
        ? null
        : <span className="structured-markdown-image-label">{alt}</span>;
    }
  }), [onOpenLink]);

  return (
    <div className="structured-markdown">
      <Markdown
        components={components}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
      >
        {children}
      </Markdown>
    </div>
  );
});
