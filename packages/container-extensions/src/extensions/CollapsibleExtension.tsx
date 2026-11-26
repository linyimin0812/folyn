import { useState } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function CollapsibleComponent({ children, attributes }: ContainerProps) {
  const [open, setOpen] = useState(attributes?.open === 'true');
  const title = attributes?.title || '点击展开';

  return (
    <div className={`docmd-collapse${open ? ' is-open' : ''}`}>
      <button
        className="docmd-collapse-head"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <svg
          className="docmd-collapse-chev"
          width="1.1em" height="1.1em" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="docmd-collapse-body">
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
