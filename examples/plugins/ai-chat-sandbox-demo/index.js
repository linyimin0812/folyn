// AI Chat Sandbox Demo — sandbox-tier plugin (iframe + postMessage).
//
// Sandbox plugins cannot import @quill/plugin-host; they reach the host via
// the RPC bridge. This file demonstrates the minimum scaffolding to call
// `ai:chat` and consume the streaming `ai-stream` events:
//
//   1. Send {type:'request', id, method:'ai:chat', params:{sessionId, prompt}}.
//   2. Listen for {type:'ai-stream', id, event} messages — push event.content.
//   3. Listen for {type:'response', id} — terminates the turn (check error).
//
// The host checks manifest.permissions.ai.chat before forwarding to runRigChat;
// undeclared calls return a `response` with `error`.

const promptEl = document.getElementById('prompt');
const askBtn = document.getElementById('ask');
const outputEl = document.getElementById('output');

let pendingStreamId = null;

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ai-stream' && msg.id === pendingStreamId) {
    const e = msg.event;
    if (e.type === 'text' && e.content) {
      outputEl.textContent += e.content;
    } else if (e.type === 'done') {
      askBtn.disabled = false;
      askBtn.textContent = 'Ask';
    } else if (e.type === 'error') {
      outputEl.textContent += `\nERROR: ${e.content ?? ''}`;
    }
  } else if (msg.type === 'response' && msg.id === pendingStreamId) {
    pendingStreamId = null;
    askBtn.disabled = false;
    askBtn.textContent = 'Ask';
    if (msg.error) {
      outputEl.textContent += `\nRPC ERROR: ${msg.error}`;
    }
  }
});

askBtn.addEventListener('click', () => {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  outputEl.textContent = '';
  askBtn.disabled = true;
  askBtn.textContent = 'Streaming…';
  const id = (crypto.randomUUID && crypto.randomUUID()) || `r-${Date.now()}`;
  pendingStreamId = id;
  window.parent.postMessage(
    {
      type: 'request',
      id,
      method: 'ai:chat',
      params: { sessionId: `sandbox-demo-${Date.now()}`, prompt },
    },
    '*',
  );
});
