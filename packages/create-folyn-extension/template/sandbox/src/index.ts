// Sandbox-tier extension entry. Runs inside a sandboxed iframe
// (`<iframe sandbox="allow-scripts">`, origin `null`) with NO access to the
// host realm — every host capability goes through window.parent.postMessage
// RPC, gated by manifest.permissions. See the SDK docs "Sandbox RPC protocol"
// section for the message shapes and the available methods (fs:read,
// clipboard:write, http:fetch, vault:read-active-doc, …).

type RpcResponse = { type: 'response'; id: string; result?: unknown; error?: string };
type Lifecycle = { type: 'lifecycle'; event: 'activate' | 'deactivate' };
type Invoke = { type: 'invoke'; id: string; command: string; params?: unknown };
type Inbound = RpcResponse | Lifecycle | Invoke;

const pending = new Map<string, (v: { result?: unknown; error?: string }) => void>();

// Commands this extension declares in manifest.contributes.commands.
// Map command id → handler. The host dispatches `invoke` messages for them.
// ponytail: empty to start — wire yours up as you add commands to the manifest.
const commands: Record<string, (params?: unknown) => unknown | Promise<unknown>> = {};

window.addEventListener('message', (e: MessageEvent<Inbound>) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'response') {
    pending.get(msg.id)?.({ result: msg.result, error: msg.error });
    pending.delete(msg.id);
  } else if (msg.type === 'lifecycle') {
    if (msg.event === 'activate') onActivate();
    // 'deactivate': the host destroys the iframe right after — best-effort cleanup.
  } else if (msg.type === 'invoke') {
    void runCommand(msg);
  }
});

let seq = 0;
function rpc(method: string, params?: unknown): Promise<unknown> {
  const id = `rpc-${++seq}`;
  return new Promise((resolve, reject) => {
    pending.set(id, ({ result, error }) =>
      error ? reject(new Error(error)) : resolve(result),
    );
    window.parent.postMessage({ type: 'request', id, method, params }, '*');
  });
}

async function runCommand(msg: Invoke): Promise<void> {
  const handler = commands[msg.command];
  const res: { type: 'invoke-result'; id: string; result?: unknown; error?: string } = {
    type: 'invoke-result',
    id: msg.id,
  };
  try {
    if (!handler) throw new Error(`no handler for command "${msg.command}"`);
    res.result = await handler(msg.params);
  } catch (err) {
    res.error = (err as Error).message;
  }
  window.parent.postMessage(res, '*');
}

// Called when the host activates this extension. Set up your UI / state here.
// Example (requires permissions.clipboard: true in the manifest):
//   void rpc('clipboard:write', { text: 'Hello from sandbox!' });
function onActivate(): void {
  // no-op until you wire up commands or UI
}
