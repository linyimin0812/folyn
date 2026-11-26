import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

const STATUS_VARIANTS = new Set(['green', 'amber', 'red', 'blue']);

function StatusTagComponent({ children, attributes }: ContainerProps) {
  const color = attributes?.color || 'blue';
  const variant = STATUS_VARIANTS.has(color) ? color : 'blue';

  return (
    <span className={`docmd-status docmd-status--${variant}`}>
      {children}
    </span>
  );
}

export const statusTagExtension: ContainerExtension = {
  name: 'status',
  icon: '🏷',
  label: '状态标签',
  category: 'data',
  component: StatusTagComponent,
  template: ':::status{color="green"}\n已完成\n:::',
  description: '行内状态标签（green/amber/red/blue）',
};
