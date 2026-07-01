// 拖拽载荷 helper：统一用 text/plain 传 JSON，兼容所有 WebView
// （Tauri WKWebView 对自定义 MIME 如 application/x-task 支持不稳）。

export type DragKind = 'event' | 'task';
export interface DragPayload {
  kind: DragKind;
  id: string;
  /** 事件原时长（小时），仅 event 携带，用于保留时长平移 */
  dur?: number;
  /** 事件原 start 的小时小数部分（如 9:30 → 0.5），用于拖动后保留分钟偏移 */
  startOffset?: number;
}

const MIME = 'text/plain';

export function setDragPayload(e: React.DragEvent, p: DragPayload) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(MIME, JSON.stringify(p));
}

export function hasDragPayload(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(MIME);
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}
