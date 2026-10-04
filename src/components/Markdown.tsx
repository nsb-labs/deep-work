import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ text }: { text: string }) {
  // External images and links in mail/model content are not fetched or navigated automatically.
  return (
    <div className="work-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => <span>[Image omitted]</span>,
          a: ({ children }) => <span>{children}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
