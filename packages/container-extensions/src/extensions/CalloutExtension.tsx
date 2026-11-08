import type { ReactNode } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

// Toned-down mid-saturation hues: readable as title text on both the white
// and the dark reading surface, and soft as a 7% tint behind body text.
const CALLOUT_VARIANTS: Record<string, { color: string; icon: ReactNode; label: string }> = {
  info: {
    color: '#4a86c8', label: 'Info',
    icon: <><circle cx="8" cy="8" r="6.25" /><path d="M8 7.25v3.75M8 5h.01" /></>,
  },
  warning: {
    color: '#c58a2a', label: 'Warning',
    icon: <><path d="M7.13 2.5 1.6 12.1a1 1 0 0 0 .87 1.5h11.06a1 1 0 0 0 .87-1.5L8.87 2.5a1 1 0 0 0-1.74 0Z" /><path d="M8 6.25v3M8 11.5h.01" /></>,
  },
  tip: {
    color: '#3f9a6c', label: 'Tip',
    icon: <><path d="M6 12.25h4M6.5 14.25h3" /><path d="M8 1.75a4.25 4.25 0 0 0-2.5 7.69c.4.3.6.7.6 1.16v.15h3.8v-.15c0-.46.2-.87.6-1.16A4.25 4.25 0 0 0 8 1.75Z" /></>,
  },
  danger: {
    color: '#cf5c55', label: 'Danger',
    icon: <><circle cx="8" cy="8" r="6.25" /><path d="M8 4.75v3.75M8 11h.01" /></>,
  },
  error: {
    color: '#c0504a', label: 'Error',
    icon: <><circle cx="8" cy="8" r="6.25" /><path d="m5.75 5.75 4.5 4.5M10.25 5.75l-4.5 4.5" /></>,
  },
  note: {
    color: '#8a6cc0', label: 'Note',
    icon: <><path d="M10.5 2.25 13.75 5.5 6 13.25H2.75V10Z" /><path d="m9 3.75 3.25 3.25" /></>,
  },
};

function CalloutComponent({ children, attributes }: ContainerProps) {
  const type = attributes?.type || 'info';
  const variant = CALLOUT_VARIANTS[type] || CALLOUT_VARIANTS.info;
  const title = attributes?.title || variant.label;

  return (
    <div className="docmd-callout" style={{
      padding: '.9em 1.1em',
      margin: '0 0 1em',
      borderRadius: '8px',
      backgroundColor: `color-mix(in srgb, ${variant.color} 7%, transparent)`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '.45em',
        fontWeight: 600, marginBottom: '.35em',
        color: variant.color,
      }}>
        <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          {variant.icon}
        </svg>
        <span>{title}</span>
      </div>
      {/* Do not display the type value — only show title above */}
      <div className="docmd-callout-body" style={{ color: 'var(--t1, #27272a)' }}>
        {children}
      </div>
    </div>
  );
}

export const calloutExtension: ContainerExtension = {
  name: 'callout',
  icon: '💡',
  label: '提示框',
  category: 'layout',
  component: CalloutComponent,
  template: ':::callout{type="info" title="提示"}\n在此输入内容\n:::',
  description: '支持 info / warning / tip / danger / error / note 类型',
};
