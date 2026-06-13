import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';

/**
 * Collect all text output from a CLI adapter stream until 'done' or 'error'.
 * Shared between wikiIngestService and clipService.
 */
export function collectTextFromStream(adapter: CliAdapter): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const handler = (event: CliStreamEvent) => {
      if (event.type === 'text' && event.content) {
        text += event.content;
      }
      if (event.type === 'error') {
        adapter.offEvent(handler);
        reject(new Error(event.content || 'LLM error'));
      }
      if (event.type === 'done') {
        adapter.offEvent(handler);
        resolve(text.trim());
      }
    };
    adapter.onEvent(handler);
  });
}
