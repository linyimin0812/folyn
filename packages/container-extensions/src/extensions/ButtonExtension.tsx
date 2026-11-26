import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function ButtonComponent({ children, attributes }: ContainerProps) {
  const href = attributes?.href || '#';
  const color = attributes?.color;
  const external = attributes?.external === 'true';
  const outline = attributes?.variant === 'outline';

  // Filled accent by default (a :::button is a CTA); `variant="outline"` is
  // the quiet secondary. A custom color overrides the token accent inline.
  const style = color && !outline ? { background: color } : undefined;

  return (
    <a
      className={`docmd-btn${outline ? ' docmd-btn--outline' : ''}`}
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      style={style}
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
  description: '可点击的链接按钮（variant="outline" 为描边样式）',
};
