import type { FileTypeHandler } from './types';

const modules = import.meta.glob<{ default: FileTypeHandler }>(
  './*/index.ts',
  { eager: true }
);

const handlers: FileTypeHandler[] = Object.values(modules).map((m) => m.default);

const extMap = new Map<string, FileTypeHandler>();
for (const handler of handlers) {
  for (const ext of handler.extensions) {
    extMap.set(ext, handler);
  }
}

export function getHandlerByExtension(ext: string): FileTypeHandler | undefined {
  return extMap.get(ext);
}

const idAliases: Record<string, string> = {
  text: 'markdown',
};

export function getHandlerById(id: string): FileTypeHandler | undefined {
  return handlers.find((h) => h.id === id)
    ?? handlers.find((h) => h.id === idAliases[id]);
}

export function getAllHandlers(): FileTypeHandler[] {
  return handlers;
}
