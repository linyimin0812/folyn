/**
 * Full-page render surface for extension-contributed pages
 * (`contributes.pages[]` → extensionPageStore). Mounted by App.tsx when
 * `currentPage` starts with `ext:` — the same composition as the built-in
 * translation page (ActivityBar + full-page component).
 *
 * The component is already `withExtensionBoundary`-wrapped at register time
 * (pageAdapter), so a render throw shows the inline "页面加载失败" fallback
 * instead of white-screening the host.
 *
 * ponytail: null render on a dangling id (extension deactivated mid-view) —
 * pageAdapter.dispose routes currentPage back to 'editor', so this only
 * flashes for one frame at worst; no fallback UI needed.
 */

import { useNavStore } from '@/store/navStore';
import { useVisiblePages } from '@/store/extensionPageStore';

export function ExtensionPageView() {
  const currentPage = useNavStore((s) => s.currentPage);
  const pages = useVisiblePages();
  const entry = pages.find((p) => p.id === currentPage);
  if (!entry) return null;
  const Component = entry.component;
  return <Component />;
}
