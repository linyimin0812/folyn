import { Children } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function TimelineComponent({ children }: ContainerProps) {
  const items = Children.toArray(children);

  return (
    <div className="docmd-timeline" style={{
      position: 'relative',
      paddingLeft: '2rem',
      margin: '1.5rem 0',
    }}>
      {/* Vertical line */}
      <div style={{
        position: 'absolute',
        left: '0.45rem',
        top: '0.5rem',
        bottom: '0.5rem',
        width: '2px',
        backgroundColor: 'var(--brd, #e4e4e7)',
      }} />
      {items.map((child, index) => (
        <div key={index} style={{
          position: 'relative',
          paddingBottom: '1.5rem',
          paddingLeft: '0.75rem',
        }}>
          {/* Dot */}
          <div style={{
            position: 'absolute',
            left: '-1.85rem',
            top: '0.45rem',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: index === 0 ? 'var(--acc, #068ad5)' : 'var(--brd, #e4e4e7)',
            border: '2px solid var(--panel, #fff)',
            zIndex: 1,
          }} />
          <div style={{ lineHeight: 1.7, color: 'var(--t2, #3f3f46)' }}>
            {child}
          </div>
        </div>
      ))}
    </div>
  );
}

export const timelineExtension: ContainerExtension = {
  name: 'timeline',
  icon: '⏳',
  label: '时间线',
  category: 'custom',
  component: TimelineComponent,
  template: ':::timeline\n**2024-01** 项目启动\n\n**2024-03** 第一个版本发布\n\n**2024-06** 正式上线\n:::',
  description: '垂直时间线布局',
};
