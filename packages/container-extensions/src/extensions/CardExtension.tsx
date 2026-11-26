import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function CardComponent({ children, attributes }: ContainerProps) {
  const title = attributes?.title;
  const icon = attributes?.icon;

  return (
    <div className="docmd-card">
      {title && (
        <div className="docmd-card-title">
          {icon && <span aria-hidden="true">{icon}</span>}
          <span>{title}</span>
        </div>
      )}
      <div className="docmd-card-body">{children}</div>
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
  description: '带标题的卡片容器',
};
