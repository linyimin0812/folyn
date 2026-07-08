// Hello Tool — sandbox-tier plugin iframe script.
//
// This runs INSIDE the sandboxed iframe (origin `quill-plugin://localhost`,
// `sandbox="allow-scripts"` without `allow-same-origin`). It has NO access to
// the parent DOM, Tauri APIs, or localStorage. The ONLY way to reach host
// capabilities is `window.parent.postMessage` — which the host's RpcBridge
// validates against the manifest's declared `permissions`.
//
// Message protocol (mirrors RpcBridge in apps/desktop/src/services/plugin-host/rpcBridge.ts):
//   iframe → host: { type: 'request',     id, method, params }
//   host → iframe: { type: 'response',    id, result?, error? }
//   host → iframe: { type: 'lifecycle',   event: 'activate' | 'deactivate' }
//   host → iframe: { type: 'invoke',      id, command, params? }   // host invoking a command we declared
//   iframe → host: { type: 'invoke-result', id, result?, error? }

(function () {
  'use strict';

  /** Monotonic id for RPC requests. */
  let nextId = 0;
  /** Pending RPC requests awaiting a host response. */
  const pending = new Map();

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    if (msg.type === 'response') {
      var p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
      return;
    }

    if (msg.type === 'lifecycle') {
      // The host sends 'activate' when the plugin is activated, 'deactivate'
      // when it is being torn down. We log to the output area for demo purposes.
      appendOut('lifecycle: ' + msg.event);
      return;
    }

    if (msg.type === 'invoke') {
      // The host invoked one of our declared commands (manifest.contributes.commands).
      // `msg.command` is the command id ('greet'). We respond with an invoke-result.
      if (msg.command === 'greet') {
        // The greet command: write to the clipboard + respond.
        rpc('clipboard:write', { text: 'Hello from Quill!' })
          .then(function () {
            sendInvokeResult(msg.id, { ok: true });
          })
          .catch(function (err) {
            sendInvokeResult(msg.id, undefined, String(err));
          });
      } else {
        sendInvokeResult(msg.id, undefined, 'unknown command: ' + msg.command);
      }
    }
  });

  /** Send an RPC request to the host and return a Promise. */
  function rpc(method, params) {
    var id = String(++nextId);
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({ type: 'request', id: id, method: method, params: params || {} }, '*');
    });
  }

  /** Send the result of a host-invoked command. */
  function sendInvokeResult(id, result, error) {
    window.parent.postMessage({ type: 'invoke-result', id: id, result: result, error: error }, '*');
  }

  function appendOut(text) {
    var el = document.getElementById('out');
    if (el) el.textContent = text;
  }

  // Wire up the demo buttons.
  document.getElementById('write').addEventListener('click', function () {
    rpc('clipboard:write', { text: 'Hello from Quill!' })
      .then(function () { appendOut('wrote to clipboard ✓'); })
      .catch(function (err) { appendOut('write failed: ' + err.message); });
  });

  document.getElementById('read').addEventListener('click', function () {
    rpc('clipboard:read', {})
      .then(function (text) { appendOut('clipboard: ' + String(text)); })
      .catch(function (err) { appendOut('read failed: ' + err.message); });
  });

  appendOut('ready');
})();
