import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  green: { bg: '#dcf5e8', color: '#22a863' },
  amber: { bg: '#fff3cd', color: '#d4820a' },
  red: { bg: '#fde8e8', color: '#d94040' },
  blue: { bg: '#dce8ff', color: '#3a6ef0' },
};

function StatusTagComponent({ children, attributes }: ContainerProps) {
  const color = attributes?.color || 'blue';
  const style = TAG_COLORS[color] || TAG_COLORS.blue;

  return (
    <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: style.bg, color: style.color }}>
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
