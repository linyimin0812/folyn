import { useState } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function CardComponent({ children, attributes }: ContainerProps) {
  const title = attributes?.title;
  const icon = attributes?.icon;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="docmd-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '1rem 1.5rem',
        marginBottom: '1.5rem',
        borderRadius: '8px',
        border: '1px solid var(--brd, #e4e4e7)',
        backgroundColor: 'var(--panel, #fff)',
        boxShadow: hovered
          ? '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)'
          : '0 2px 5px -3px rgba(0,0,0,0.15)',
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
    >
      {title && (
        <div style={{
          fontWeight: 700,
          fontSize: '1.125rem',
          margin: '-1rem -1.5rem 1rem',
          padding: '.75rem 1.5rem',
          backgroundColor: 'var(--surf, #fafafa)',
          borderBottom: '1px solid var(--brd, #e4e4e7)',
          borderRadius: '8px 8px 0 0',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: 'var(--t1, #09090b)',
        }}>
          {icon && <span>{icon}</span>}
          {title}
        </div>
      )}
      <div style={{ lineHeight: 1.7, color: 'var(--t2, #3f3f46)' }}>
        {children}
      </div>
    </div>
  );
}

export const cardExtension: ContainerExtension = {
  name: 'card',
  icon: '🃏',
  label: '卡片',
  category: 'layout',
  component: CardComponent,
  template: ':::card{title="卡片标题" icon="📌"}\n卡片内容\n:::',
  description: '带悬停效果的卡片容器',
};
