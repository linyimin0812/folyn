// AI Chat Demo — trusted-tier plugin (in-process).
//
// Demonstrates the host-mediated AI capability surface:
//   - `ctx.ai.chat(params)`  — streaming chat through the host's configured
//                              provider (provider/model/apiKey never exposed).
//   - `ctx.ai.agent(params)` — drive a registered feature agent (study).
//
// Both methods require `permissions.ai` in manifest.json. The host checks the
// whitelist before any AI call — see `aiCapability.ts`.
//
// Export contract: `features` + `commands` + `activate`. The `activate` hook
// receives the PluginContext; we stash `ctx` on a module-level binding so the
// panel and command handler can reach it. (A real plugin may prefer to thread
// ctx through a closure.)

/** @type {import('@quill/plugin-host').PluginContext | null} */
let cachedCtx = null;

function AiChatPanel() {
  const React = _loadReact();
  const { createElement: h, useState, useRef } = React;

  const [prompt, setPrompt] = useState('Summarize the active doc in 3 bullets.');
  const [stream, setStream] = useState('');
  const [running, setRunning] = useState(false);

  async function runChat() {
    if (!cachedCtx?.ai) {
      console.error('[ai-chat-demo] PluginContext.ai unavailable');
      return;
    }
    setRunning(true);
    setStream('');
    const sid = `demo-${Date.now()}`;
    try {
      await cachedCtx.ai.chat({
        sessionId: sid,
        prompt,
        onEvent: (e) => {
          if (e.type === 'text' && e.content) {
            setStream((prev) => prev + e.content);
          } else if (e.type === 'error') {
            setStream(`ERROR: ${e.content ?? ''}`);
          }
        },
        useSharedSession: true,
      });
    } catch (err) {
      console.error('[ai-chat-demo] chat failed:', err);
    } finally {
      setRunning(false);
    }
  }

  return h(
    'div',
    {
      style: {
        display: 'flex', flexDirection: 'column', height: '100%',
        padding: '8px', gap: '8px', boxSizing: 'border-box',
      },
    },
    [
      h('div', { key: 'title', style: { fontSize: '12px', color: 'var(--t2,#8a8f98)', textTransform: 'uppercase', letterSpacing: '0.04em' } }, 'AI Chat (sample plugin)'),
      h('textarea', {
        key: 'ta', value: prompt,
        onChange: (e) => setPrompt(e.target.value),
        placeholder: 'Ask the host AI…',
        style: { minHeight: '60px', resize: 'none', border: '1px solid var(--brd,#2a2a2a)', background: 'var(--panel,#1e1e1e)', color: 'var(--t1,#e6e6e6)', borderRadius: '4px', padding: '6px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
      }),
      h('button', {
        key: 'btn', onClick: runChat, disabled: running || !prompt.trim(),
        style: { alignSelf: 'flex-start', padding: '4px 10px', border: '1px solid var(--brd,#2a2a2a)', background: 'var(--accdim,#2a2a3a)', color: 'var(--acc,#6366f1)', borderRadius: '4px', cursor: running ? 'wait' : 'pointer', fontSize: '12px' },
      }, running ? 'Streaming…' : 'Ask'),
      h('pre', {
        key: 'out',
        style: { flex: 1, margin: 0, padding: '6px', fontSize: '12px', whiteSpace: 'pre-wrap', overflow: 'auto', background: 'var(--inp,#0f1219)', border: '1px solid var(--brd,#2a2a2a)', borderRadius: '4px', color: 'var(--t1,#e6e6e6)' },
      }, stream || '(output)'),
    ],
  );
}

async function askStudyAgentCommand() {
  if (!cachedCtx?.ai) {
    console.error('[ai-chat-demo] PluginContext.ai unavailable');
    return;
  }
  try {
    await cachedCtx.ai.agent({
      feature: 'study',
      instruction: 'Review the active doc and surface 3 things to learn next.',
      onEvent: (e) => console.info('[ai-chat-demo] agent event:', e.type, e.content ?? ''),
    });
    console.info('[ai-chat-demo] study agent done');
  } catch (err) {
    console.error('[ai-chat-demo] agent failed:', err);
  }
}

function _loadReact() {
  if (typeof window !== 'undefined' && window.React) return window.React;
  throw new Error('[ai-chat-demo] React not available — host must expose window.React');
}

export const features = { 'ai-chat-panel': AiChatPanel };
export const commands = { 'ask-study-agent': askStudyAgentCommand };

export function activate(ctx) {
  cachedCtx = ctx;
  console.info('[ai-chat-demo] activated');
}

export function deactivate() {
  cachedCtx = null;
  console.info('[ai-chat-demo] deactivated');
}
