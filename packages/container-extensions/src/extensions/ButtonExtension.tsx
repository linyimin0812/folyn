import { useState } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function ButtonComponent({ children, attributes }: ContainerProps) {
  const href = attributes?.href || '#';
  const color = attributes?.color;
  const external = attributes?.external === 'true';
  const [hovered, setHovered] = useState(false);

  const baseColor = color || 'var(--acc, #068ad5)';

  return (
    <a
      className="docmd-button"
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-block',
        padding: '.6rem 1.2rem',
        margin: '.5rem',
        borderRadius: '6px',
        backgroundColor: baseColor,
        fontWeight: 500,
        color: '#fff',
        textDecoration: 'none',
        border: 'none',
        cursor: 'pointer',
        transition: 'background-color .2s, transform .2s',
        filter: hovered ? 'brightness(110%)' : 'none',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      {children}
    </a>
  );
}

export const buttonExtension: ContainerExtension = {
  name: 'button',
  icon: '🔘',
  label: '按钮',
  category: 'layout',
  component: ButtonComponent,
  template: ':::button{href="https://example.com" external="true"}\n点击访问\n:::',
  description: '可点击的链接按钮',
};
