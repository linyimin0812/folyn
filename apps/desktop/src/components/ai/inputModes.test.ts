import { describe, it, expect } from 'vitest';
import { registerInputMode, getInputModeDef, listInputModes, resolveSendOptions } from './inputModes';
import type { CliSendOptions } from '@folyn/cli-adapter';

describe('inputModes built-ins', () => {
  it('registers chat, agent and ask in display order (Chat → Agent → Ask)', () => {
    const ids = listInputModes().map((m) => m.id);
    expect(ids).toContain('chat');
    expect(ids).toContain('agent');
    expect(ids).toContain('ask');
    expect(ids.indexOf('chat')).toBeLessThan(ids.indexOf('agent'));
    expect(ids.indexOf('agent')).toBeLessThan(ids.indexOf('ask'));
  });

  it('chat def is served by the rig backend', () => {
    expect(getInputModeDef('chat')?.backend).toBe('rig');
  });

  it('built-in modes carry an icon for the icon-only trigger', () => {
    expect(getInputModeDef('chat')?.icon).toBeTruthy();
    expect(getInputModeDef('agent')?.icon).toBeTruthy();
    expect(getInputModeDef('ask')?.icon).toBeTruthy();
  });

  it('agent def uses bypassPermissions', () => {
    expect(getInputModeDef('agent')?.permissionMode).toBe('bypassPermissions');
  });

  it('agent def sets bare:false so user/project skills are discovered', () => {
    const out = resolveSendOptions('agent', { resumeSessionId: 'rs-1' });
    expect(out.bare).toBe(false);
    expect(out.permissionMode).toBe('bypassPermissions');
  });

  it('ask def uses plan (read-only)', () => {
    expect(getInputModeDef('ask')?.permissionMode).toBe('plan');
  });
});

describe('registerInputMode', () => {
  it('registers a custom mode that appears in listInputModes', () => {
    registerInputMode({ id: 'test-custom', label: 'Custom', permissionMode: 'acceptEdits' });
    const def = getInputModeDef('test-custom');
    expect(def?.label).toBe('Custom');
    expect(listInputModes().map((m) => m.id)).toContain('test-custom');
  });

  it('replacing an existing id keeps its position', () => {
    registerInputMode({ id: 'test-pos', label: 'V1' });
    const beforeIdx = listInputModes().findIndex((m) => m.id === 'test-pos');
    registerInputMode({ id: 'test-pos', label: 'V2' });
    const after = listInputModes();
    expect(after[beforeIdx].id).toBe('test-pos');
    expect(after[beforeIdx].label).toBe('V2');
  });
});

describe('resolveSendOptions', () => {
  const base: CliSendOptions = { resumeSessionId: 'rs-1' };

  it('unknown mode id returns base unchanged', () => {
    expect(resolveSendOptions('no-such-mode', base)).toEqual(base);
  });

  it('merges permissionMode from the mode def', () => {
    const out = resolveSendOptions('ask', base);
    expect(out.permissionMode).toBe('plan');
    expect(out.resumeSessionId).toBe('rs-1');
  });

  it('merges systemPrompt and bare when present', () => {
    registerInputMode({
      id: 'test-sp',
      label: 'SP',
      permissionMode: 'plan',
      systemPrompt: 'be concise',
      bare: false,
    });
    const out = resolveSendOptions('test-sp', base);
    expect(out.permissionMode).toBe('plan');
    expect(out.systemPrompt).toBe('be concise');
    expect(out.bare).toBe(false);
  });

  it('does not override fields the caller already set unless def provides them', () => {
    const out = resolveSendOptions('agent', { ...base, systemPrompt: 'caller' });
    expect(out.systemPrompt).toBe('caller');
    expect(out.permissionMode).toBe('bypassPermissions');
  });

  it('buildSendOptions escape hatch runs after declarative merge and can override', () => {
    const seen: CliSendOptions[] = [];
    registerInputMode({
      id: 'test-escape',
      label: 'Esc',
      permissionMode: 'plan',
      buildSendOptions: (merged) => {
        seen.push(merged);
        return { ...merged, permissionMode: 'acceptEdits', agent: 'wiki' };
      },
    });
    const out = resolveSendOptions('test-escape', base);
    expect(seen[0].permissionMode).toBe('plan'); // declarative merge happened first
    expect(out.permissionMode).toBe('acceptEdits'); // escape hatch overrode
    expect(out.agent).toBe('wiki');
  });
});
