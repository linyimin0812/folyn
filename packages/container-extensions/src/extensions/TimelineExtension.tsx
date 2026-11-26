import { Children } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function TimelineComponent({ children }: ContainerProps) {
  const items = Children.toArray(children);

  return (
    <div className="docmd-timeline">
      {/* Vertical rail */}
      <div className="docmd-timeline-line" />
      {items.map((child, index) => (
        <div key={index} className="docmd-timeline-item">
          <span className="docmd-timeline-dot" />
          <div className="docmd-timeline-body">{child}</div>
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
