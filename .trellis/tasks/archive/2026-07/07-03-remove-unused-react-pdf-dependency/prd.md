# remove unused react-pdf dependency

## Goal

移除已无引用的 `react-pdf` 依赖（旧 PdfViewer 删除后遗留）。`html2pdf.js` 仍被 useExport 使用，保留。

## What I already know

- `apps/desktop/package.json` 有 `react-pdf ^10.4.1` 与 `html2pdf.js ^0.14.0`。
- grep：`react-pdf` 在 src 下 0 引用；`html2pdf.js` 在 `hooks/useExport.ts` 使用。
- PDF 预览已交 file-viewer（preset-office 的 pdf.js），不再需要 react-pdf。

## Requirements

- 从 `apps/desktop/package.json` 移除 `react-pdf`。
- `pnpm install` 更新 lockfile。
- 保留 `html2pdf.js`。
- tsc + vitest + vite build 绿。

## Acceptance Criteria

- [ ] `react-pdf` 不在 package.json。
- [ ] pnpm-lock.yaml 更新。
- [ ] tsc + vitest + vite build 绿。

## Out of Scope

- 不动 html2pdf.js。
- 不动 file-viewer 相关依赖。

## Technical Notes

- `pnpm --filter @folyn/desktop remove react-pdf` 或手改 package.json + `pnpm install`。
