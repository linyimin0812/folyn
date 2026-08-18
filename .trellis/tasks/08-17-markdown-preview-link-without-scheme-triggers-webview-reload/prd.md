# markdown preview link without scheme triggers webview reload

## Problem

In `MarkdownPreview.tsx` `map['a']` (apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:551), only hrefs starting with `http://` / `https://` are treated as external links. A markdown link like `[baidu](www.baidu.com)` — no scheme — is parsed by remark as a relative path, so `href = "www.baidu.com"`, `isExternal` is false, and the link falls through to a plain `<a href>`. Clicking it makes the Tauri webview try to navigate to that path, which looks to the user like the whole app restarting.

## Root Cause

`map['a']` only matches the `http(s)://` prefix. Any href that looks like a URL but lacks a scheme (e.g. `www.baidu.com`, `baidu.com`) bypasses the external-link branch and hits the default `createElement('a', { href, ...rest }, children)`.

## Fix

In `map['a']`, before the `isExternal` check, normalize a scheme-less www. href to `https://www.<rest>` so it routes through the existing two-mode (internal web tab vs. external browser) logic keyed on `linkOpenMode`.

Scope: handle the reported case (`www.` prefix). Bare-domain (`baidu.com`) and protocol-relative (`//host`) are NOT in scope for this task — `www.` is the common markdown mistake; expand later if reported.

## Acceptance

- `[baidu](www.baidu.com)` in a markdown preview, with `linkOpenMode = 'internal'`, opens a web tab (same as `[baidu](https://www.baidu.com)`).
- With `linkOpenMode = 'external'` (or non-internal), opens in the system browser.
- Http(s) links and anchor/file links behave unchanged.
- No new dependency, no new abstraction.

## Out of scope

- Bare-domain hrefs without `www.` (e.g. `baidu.com`).
- Anchor (`#id`) scroll-to-heading.
- Relative-file-link open-as-tab.
