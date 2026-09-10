import { Children } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function GridComponent({ children, attributes }: ContainerProps) {
  const columns = parseInt(attributes?.cols || '0', 10);
  // Always use auto-fit for responsive wrapping; cols determines the min-width hint
  const minWidth = columns > 0 ? `${Math.floor(100 / columns) - 5}%` : '280px';
  const gridColumns = `repeat(auto-fit, minmax(min(${minWidth}, 100%), 1fr))`;

  const items = Children.toArray(children);

  return (
    <div className="docmd-grid" style={{
      display: 'grid',
      gridTemplateColumns: gridColumns,
      gap: '1.5rem',
      margin: '1rem 0',
      width: '100%',
    }}>
      {items.map((child, index) => (
        <div key={index} className="docmd-grid-item">
          {child}
        </div>
      ))}
    </div>
  );
}

export const gridExtension: ContainerExtension = {
  name: 'grid',
  icon: '⊞',
  label: '网格布局',
  category: 'layout',
  component: GridComponent,
  template: '::::grid{cols="3"}\n:::card{title="特性 1" icon="🚀"}\n描述内容\n:::\n:::card{title="特性 2" icon="⚡"}\n描述内容\n:::\n:::card{title="特性 3" icon="🔒"}\n描述内容\n:::\n::::',
  description: '自适应多列网格',
};
