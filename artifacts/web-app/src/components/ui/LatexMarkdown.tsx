import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import React from 'react';

export default function LatexMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p style={{ margin: 0, lineHeight: 1.6 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: 0, paddingLeft: '1.5rem', listStyleType: 'disc' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: 0, paddingLeft: '1.5rem', listStyleType: 'decimal' }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: '0.25rem' }}>{children}</li>,
          h1: ({ children }) => <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '1rem 0 0.5rem' }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0.75rem 0 0.5rem' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: '0.5rem 0' }}>{children}</h3>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
