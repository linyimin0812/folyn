import { useEffect } from 'react';

/**
 * 强制关闭所有文本输入元素的首字母自动大写 / 自动纠正 / 拼写检查。
 * Tauri (WKWebView) 对 <html autocapitalize="off"> 的继承不可靠，
 * 因此逐元素强制设置，并对后续动态插入的节点保持同步。
 *
 * Must be mounted in EVERY Tauri window that renders text inputs — the main
 * window (App.tsx) and the pet-panel window (PetPanelApp.tsx) are separate
 * JS realms, so the main window's observer never reaches the panel's search
 * box / chat input.
 */
export function useDisableAutoCapitalize() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const TARGET = 'input, textarea, [contenteditable=""], [contenteditable="true"]';
    const apply = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(TARGET).forEach((el) => {
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
      });
    };
    apply(document);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as HTMLElement;
          if (el.matches?.(TARGET)) {
            el.setAttribute('autocapitalize', 'off');
            el.setAttribute('autocorrect', 'off');
            el.setAttribute('spellcheck', 'false');
          }
          apply(el);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
