import { useState } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function CollapsibleComponent({ children, attributes }: ContainerProps) {
  const [open, setOpen] = useState(attributes?.open === 'true');
  const title = attributes?.title || '点击展开';

  return (
    <div className="docmd-collapsible" style={{
      border: `1px solid ${open ? 'var(--acc, #068ad5)' : 'var(--brd, #e4e4e7)'}`,
      borderRadius: '8px',
      overflow: 'hidden',
      marginBottom: '1.5rem',
      transition: 'border-color .2s',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          listStyle: 'none',
          padding: '.75rem 1.25rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          fontWeight: 600,
          fontSize: '14px',
          backgroundColor: 'var(--surf, #fafafa)',
          border: 'none',
          color: 'var(--t1, #09090b)',
          textAlign: 'left',
          transition: 'background-color .15s',
        }}
      >
        <span>{title}</span>
        <svg
          width="1.2em" height="1.2em" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            transition: 'transform .2s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            opacity: 0.7,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{
          padding: '1rem 1.25rem',
          borderTop: '1px solid var(--brd, #e4e4e7)',
          lineHeight: 1.7,
          color: 'var(--t2, #3f3f46)',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

export const collapsibleExtension: ContainerExtension = {
  name: 'collapsible',
  icon: '🔽',
  label: '折叠面板',
  category: 'layout',
  component: CollapsibleComponent,
  template: ':::collapsible{title="点击展开详情"}\n折叠内容在此\n:::',
  description: '可展开/收起的手风琴面板',
};
