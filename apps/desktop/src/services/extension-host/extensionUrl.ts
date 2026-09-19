/**
 * Extension asset URL builder — the ONE place that knows how to address the
 * `folyn-extension://` scheme from host JS.
 *
 * macOS/Linux: WKWebView / webkitgtk serve the registered scheme natively at
 * `folyn-extension://localhost/<id>/<file>`.
 *
 * Windows (WebView2): a custom scheme is only reachable as the virtual host
 * `http://<scheme>.localhost/<path>` (tauri `register_uri_scheme_protocol`
 * docs: "Windows and Android: http://<scheme_name>.localhost/<path>"). The
 * raw `scheme://` form is an unknown external protocol there — navigating a
 * sandboxed iframe to it is blocked ("Navigation to external protocol
 * blocked by sandbox", chromestatus 5680742077038592), which is exactly the
 * Windows blank-tool error this helper exists to prevent. Same rule as
 * Tauri's runtime `convertFileSrc` (tauri scripts/core.js: windows →
 * `${protocolScheme}://${scheme}.localhost`).
 *
 * Platform detection mirrors Tauri's `osName === 'windows'` compile-time
 * template with a userAgent check (the only signal available in the webview;
 * jsdom's UA contains no "Windows", so tests keep the scheme:// form).
 */

export function extensionAssetUrl(extensionId: string, file: string): string {
  const base = navigator.userAgent.includes('Windows')
    ? `${window.location.protocol}//folyn-extension.localhost`
    : 'folyn-extension://localhost';
  return `${base}/${extensionId}/${file}`;
}
