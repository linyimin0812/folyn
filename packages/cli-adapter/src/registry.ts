import type { CliAdapter } from './types';
import { ClaudeAdapter } from './claudeAdapter';
import { PiAdapter } from './piAdapter';

type AdapterDescriptor = {
  displayName: string;
  description: string;
  factory: () => CliAdapter;
};

const ADAPTERS: Record<string, AdapterDescriptor> = {
  claude: {
    displayName: 'Claude Code',
    description: 'Anthropic 官方 CLI 工具，支持对话式编辑与多工具调用',
    factory: () => new ClaudeAdapter(),
  },
  pi: {
    displayName: 'Pi',
    description: 'pi 代码 Agent（@earendil-works/pi-coding-agent），read/bash/edit/write 工具，rpc 多轮会话',
    factory: () => new PiAdapter(),
  },
};

/** List all registered CLI adapters (id + display metadata). */
export function listAdapters(): { id: string; displayName: string; description: string }[] {
  return Object.entries(ADAPTERS).map(([id, d]) => ({
    id,
    displayName: d.displayName,
    description: d.description,
  }));
}

/** Create an adapter instance by id. Throws if the id is unknown. */
export function createAdapter(id: string): CliAdapter {
  const descriptor = ADAPTERS[id];
  if (!descriptor) {
    throw new Error(`CLI adapter "${id}" not found`);
  }
  return descriptor.factory();
}
