import { PlantUmlBlock } from '@quill/container-plugins';
import type { PreviewProps } from '../types';

// ponytail: thin wrapper — the .puml Preview is just PlantUmlBlock fed with
// the file content. CodeMirror handles the editor pane; this handles the
// preview pane. The file-type handler auto-registers via `import.meta.glob`.
export function PlantUmlPreview({ content }: PreviewProps) {
  return <PlantUmlBlock source={content} />;
}
