import { ContainerRegistry } from '@folyn/container-plugins';
import type { ReactNode } from 'react';

interface ContainerRendererProps {
  name: string;
  attributes?: Record<string, string>;
  children?: ReactNode;
}

export function ContainerRenderer({ name, attributes, children }: ContainerRendererProps) {
  const registry = ContainerRegistry.getInstance();
  const plugin = registry.get(name);

  if (!plugin) {
    return (
      <div style={{
        padding: '8px 12px', background: '#fde8e8', borderRadius: '6px',
        fontSize: '12px', color: '#d94040', margin: '8px 0',
      }}>
        未知容器: <code>{name}</code>
      </div>
    );
  }

  const Component = plugin.component;
  return <Component attributes={attributes}>{children}</Component>;
}
