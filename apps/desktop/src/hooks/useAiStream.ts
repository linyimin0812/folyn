import { useCallback } from 'react';
import { useAiStore } from '@/store/aiStore';
import { useSettingsStore, type LlmProvider } from '@/store/settingsStore';

interface StreamCallbacks {
  onToken: (text: string) => void;
  onThinking: (text: string) => void;
  onError: (text: string) => void;
}

async function streamAnthropic(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
  callbacks: StreamCallbacks,
) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    stream: true,
    messages: messages.map((m) => ({
      role: m.role === 'ai' ? 'assistant' : m.role,
      content: m.content,
    })),
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    callbacks.onError(`[Anthropic ${response.status}] ${errorText}`);
    return;
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) return;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') break;
      try {
        const data = JSON.parse(raw);
        if (data.type === 'content_block_delta') {
          if (data.delta?.type === 'text_delta') {
            callbacks.onToken(data.delta.text);
          } else if (data.delta?.type === 'thinking_delta') {
            callbacks.onThinking(data.delta.thinking);
          }
        }
      } catch { /* skip malformed */ }
    }
  }
}

async function streamOpenAI(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
  callbacks: StreamCallbacks,
  baseUrl = 'https://api.openai.com/v1',
) {
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'ai' ? 'assistant' : m.role,
      content: m.content,
    })),
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      messages: allMessages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    callbacks.onError(`[${response.status}] ${errorText}`);
    return;
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) return;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') break;
      try {
        const data = JSON.parse(raw);
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) {
          callbacks.onToken(delta.content);
        }
      } catch { /* skip malformed */ }
    }
  }
}

async function streamOllama(
  messages: { role: string; content: string }[],
  model: string,
  systemPrompt: string,
  ollamaUrl: string,
  callbacks: StreamCallbacks,
) {
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'ai' ? 'assistant' : m.role,
      content: m.content,
    })),
  ];

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: allMessages, stream: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    callbacks.onError(`[Ollama ${response.status}] ${errorText}`);
    return;
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) return;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.message?.content) {
          callbacks.onToken(data.message.content);
        }
      } catch { /* skip malformed */ }
    }
  }
}

const OPENAI_COMPAT_PROVIDERS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function useAiStream() {
  const addMessage = useAiStore((s) => s.addMessage);
  const appendToLastMessage = useAiStore((s) => s.appendToLastMessage);
  const appendThinking = useAiStore((s) => s.appendThinking);
  const setStreaming = useAiStore((s) => s.setStreaming);
  const messages = useAiStore((s) => s.messages);

  const send = useCallback(
    async (prompt: string, _mode: 'chat' | 'agent' = 'chat') => {
      const settings = useSettingsStore.getState();

      addMessage('user', prompt);
      addMessage('ai', '');
      setStreaming(true);

      const history = messages.map((msg) => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content,
      }));
      history.push({ role: 'user', content: prompt });

      const callbacks: StreamCallbacks = {
        onToken: (text) => appendToLastMessage(text),
        onThinking: (text) => appendThinking(text),
        onError: (text) => appendToLastMessage(`\n\n${text}`),
      };

      try {
        const provider = settings.llmProvider as LlmProvider;

        if (provider === 'anthropic') {
          await streamAnthropic(
            history, settings.llmApiKey, settings.llmModel,
            settings.systemPrompt, settings.temperature, settings.maxTokens,
            callbacks,
          );
        } else if (provider === 'local') {
          await streamOllama(
            history, settings.llmModel, settings.systemPrompt,
            settings.ollamaUrl, callbacks,
          );
        } else {
          const baseUrl = OPENAI_COMPAT_PROVIDERS[provider] || 'https://api.openai.com/v1';
          await streamOpenAI(
            history, settings.llmApiKey, settings.llmModel,
            settings.systemPrompt, settings.temperature, settings.maxTokens,
            callbacks, baseUrl,
          );
        }
      } catch {
        appendToLastMessage('\n\n[连接错误，请检查 API Key 和网络设置]');
      } finally {
        setStreaming(false);
      }
    },
    [addMessage, appendToLastMessage, appendThinking, setStreaming, messages],
  );

  return { send };
}
