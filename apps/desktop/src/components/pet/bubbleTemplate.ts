// Bubble template engine: tokenizer + render + sanitize + built-in presets.
//
// Custom minimal mustache-like syntax — no deps. Supports:
//   {{key}}                       scalar (dotted: {{data.foo}}, {{target.kind}})
//   {{#key}}...{{/key}}           truthy/array iteration
//                                 - array: block rendered per item, {{field}} resolves to item
//                                 - truthy scalar: block rendered once against root
//                                 - falsy: block dropped
// No partials, no JS eval. Three-layer XSS defense:
//   1. All scalar values are HTML-escaped before substitution.
//   2. The final HTML is passed through DOMPurify (script/style/iframe/etc
//      stripped, on* attrs removed).
//   3. The bubble window carries a CSP <meta> that blocks remote resources.

import DOMPurify from 'dompurify';
import type { PetBubblePayload } from './PetBubbleApp';

/** A user-uploaded or built-in template. `id` is the selector used by
 *  `payload.template` and `petStore.activeTemplateId`. */
export interface BubbleTemplate {
  id: string;
  name: string;
  html: string;
  css: string;
  /** Declared placeholders — informational only, not enforced. Used by the
   *  settings UI to hint which fields the template expects. */
  fields?: string[];
  /** Preferred bubble window size in LOGICAL points. Missing → default
   *  320×120 (matches `tauri.conf.json` `pet-bubble` window). When present,
   *  `PetBubbleApp` invokes `pet_bubble_set_size` with the physical-pixel
   *  equivalent before `pet_bubble_show` so the window matches the card. */
  size?: { width: number; height: number };
}

/** Tokenize a template against a payload. Returns final HTML string. */
export function renderTemplate(template: BubbleTemplate, payload: PetBubblePayload): string {
  const expanded = expandBlocks(template.html, payload);
  return replaceScalars(expanded, payload);
}

/** DOMPurify wrapper with the strictest config reasonable for a bubble. */
export function sanitizeBubbleHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
    FORBID_ATTR: ['on*'],
    ALLOW_DATA_ATTR: true,
  });
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}

function resolveScalar(path: string, root: unknown): string {
  const parts = path.split('.');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return '';
  if (typeof cur === 'string') return escapeHtml(cur);
  if (typeof cur === 'number' || typeof cur === 'boolean') return escapeHtml(String(cur));
  // arrays/objects: empty for scalar slot — caller should use block iteration.
  return '';
}

function isTruthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return true;
  return false;
}

function replaceScalars(html: string, payload: PetBubblePayload): string {
  return html.replace(/\{\{([^{}#/]+)\}\}/g, (_m, expr: string) => {
    const key = expr.trim();
    return resolveScalar(key, payload);
  });
}

function expandBlocks(html: string, payload: PetBubblePayload): string {
  // ponytail: one block syntax `{{#name}}...{{/name}}`, no nesting.
  // Re-scan up to 4 passes — non-nested blocks converge in 1-2 passes.
  let out = html;
  for (let i = 0; i < 4; i++) {
    const next = expandOneBlock(out, payload);
    if (next === out) break;
    out = next;
  }
  return out;
}

function expandOneBlock(html: string, payload: PetBubblePayload): string {
  const m = html.match(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/);
  if (!m) return html;
  const [, name, body] = m;
  const list = (payload as unknown as Record<string, unknown>)[name];
  if (Array.isArray(list)) {
    const items = list.slice(0, 2);
    const rendered = items
      .map((item) => {
        const ctx = (typeof item === 'object' && item !== null) ? item : { this: item };
        return replaceScalars(body, ctx as PetBubblePayload);
      })
      .join('');
    return html.replace(m[0], rendered);
  }
  if (isTruthy(list)) {
    return html.replace(m[0], replaceScalars(body, payload));
  }
  return html.replace(m[0], '');
}

/** Built-in templates. `default` mirrors the original pet.css bubble card so
 *  existing users see no regression. The React shell renders
 *  `<div class="pet-bubble-root pet-bubble--{kind}">` and the template HTML
 *  is injected inside, so templates may use `var(--bubble-accent)`. */
export const BUILT_IN_TEMPLATES: BubbleTemplate[] = [
  {
    id: 'default',
    name: '默认白卡',
    html:
      '<div class="pet-bubble-card">' +
        '<button class="pet-bubble-close" data-action="close" aria-label="关闭">✕</button>' +
        '{{#title}}<div class="pet-bubble-title" data-action="navigate">{{title}}</div>{{/title}}' +
        '<div class="pet-bubble-text">{{text}}</div>' +
        '{{#actions}}<div class="pet-bubble-actions"><button class="pet-bubble-btn pet-bubble-btn--{{kind}}" data-action="{{id}}">{{label}}</button></div>{{/actions}}' +
      '</div>',
    css:
      '.pet-bubble-card { background: var(--panel, #ffffff); border-radius: 10px; box-shadow: inset 3px 0 0 0 var(--bubble-accent, #3a6ef0), 0 4px 12px rgba(0,0,0,0.08); padding: 10px 12px; height: 100%; box-sizing: border-box; position: relative; }' +
      '.pet-bubble-close { position: absolute; top: 4px; right: 6px; border: none; background: transparent; cursor: pointer; font-size: 12px; color: #888; }' +
      '.pet-bubble-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; color: #111827; }' +
      '.pet-bubble-text { font-size: 12px; color: #374151; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }' +
      '.pet-bubble-actions { margin-top: 6px; display: flex; gap: 6px; }' +
      '.pet-bubble-btn { font-size: 11px; padding: 3px 10px; border-radius: 6px; cursor: pointer; border: none; }' +
      '.pet-bubble-btn--primary { background: var(--bubble-accent, #3a6ef0); color: white; }' +
      '.pet-bubble-btn--ghost { background: transparent; color: var(--bubble-accent, #3a6ef0); }',
    fields: ['title', 'text', 'actions'],
  },
  {
    id: 'glass',
    name: '玻璃拟态',
    html:
      '<div class="bubble glass-bubble">' +
        '<div class="bubble-tail"></div>' +
        '<button class="bubble-close" data-action="close">✕</button>' +
        '{{#title}}<div class="bubble-title">{{title}}</div>{{/title}}' +
        '<div class="bubble-text">{{text}}</div>' +
        '{{#actions}}<div class="bubble-actions"><button class="bubble-btn" data-action="{{id}}">{{label}}</button></div>{{/actions}}' +
      '</div>',
    css:
      '.glass-bubble { background: rgba(255,255,255,0.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,0.45); border-radius: 14px; padding: 12px 14px; height: 100%; box-sizing: border-box; position: relative; overflow: hidden; }' +
      '.bubble-tail { width: 12px; height: 12px; background: rgba(255,255,255,0.55); transform: rotate(45deg); position: absolute; bottom: -6px; left: 24px; border-right: 1px solid rgba(255,255,255,0.45); border-bottom: 1px solid rgba(255,255,255,0.45); }' +
      '.bubble-close { position: absolute; top: 4px; right: 6px; border: none; background: transparent; cursor: pointer; font-size: 12px; color: #6b7280; }' +
      '.bubble-title { font-weight: 600; font-size: 13px; color: #1f2937; margin-bottom: 4px; }' +
      '.bubble-text { font-size: 12px; color: #374151; line-height: 1.4; }' +
      '.bubble-actions { margin-top: 8px; display: flex; gap: 6px; }' +
      '.bubble-btn { background: var(--bubble-accent, #3a6ef0); color: white; border: none; border-radius: 8px; padding: 4px 10px; font-size: 11px; cursor: pointer; }',
    fields: ['title', 'text', 'actions'],
  },
  {
    id: 'dark',
    name: '暗夜',
    html:
      '<div class="bubble dark-bubble">' +
        '<button class="bubble-close" data-action="close">✕</button>' +
        '{{#title}}<div class="bubble-title">{{title}}</div>{{/title}}' +
        '<div class="bubble-text">{{text}}</div>' +
        '{{#actions}}<div class="bubble-actions"><button class="bubble-btn bubble-btn--primary" data-action="{{id}}">{{label}}</button></div>{{/actions}}' +
      '</div>',
    css:
      '.dark-bubble { background: #1e1e2e; border-radius: 12px; padding: 12px 14px; height: 100%; box-sizing: border-box; box-shadow: 0 0 24px var(--bubble-accent, #3a6ef0); border: 1px solid rgba(255,255,255,0.06); position: relative; }' +
      '.dark-bubble .bubble-close { position: absolute; top: 4px; right: 6px; border: none; background: transparent; cursor: pointer; font-size: 12px; color: #6b7280; }' +
      '.dark-bubble .bubble-title { font-weight: 600; font-size: 13px; color: #f3f4f6; margin-bottom: 4px; }' +
      '.dark-bubble .bubble-text { font-size: 12px; color: #cbd5e1; line-height: 1.4; }' +
      '.dark-bubble .bubble-actions { margin-top: 8px; display: flex; gap: 6px; }' +
      '.dark-bubble .bubble-btn--primary { background: var(--bubble-accent, #3a6ef0); color: white; border: none; border-radius: 8px; padding: 4px 10px; font-size: 11px; cursor: pointer; }',
    fields: ['title', 'text', 'actions'],
  },
  {
    id: 'minimal',
    name: '极简 toast',
    html:
      '<div class="bubble minimal-bubble">' +
        '<div class="bubble-text">{{text}}</div>' +
        '{{#actions}}<button class="bubble-link" data-action="{{id}}">{{label}}</button>{{/actions}}' +
        '<button class="bubble-close-min" data-action="close">✕</button>' +
      '</div>',
    css:
      '.minimal-bubble { background: #f3f4f6; border-radius: 6px; padding: 8px 10px; height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 8px; }' +
      '.minimal-bubble .bubble-text { font-size: 12px; color: #111827; flex: 1; line-height: 1.3; }' +
      '.minimal-bubble .bubble-link { background: none; border: none; color: var(--bubble-accent, #3a6ef0); font-size: 11px; cursor: pointer; padding: 0; }' +
      '.minimal-bubble .bubble-close-min { background: none; border: none; color: #9ca3af; font-size: 11px; cursor: pointer; padding: 0; }',
    fields: ['text', 'actions'],
  },
  {
    id: 'colorful',
    name: '彩色卡片',
    html:
      '<div class="bubble colorful-bubble">' +
        '<div class="bubble-icon">📣</div>' +
        '<div class="bubble-content">' +
          '{{#title}}<div class="bubble-title">{{title}}</div>{{/title}}' +
          '<div class="bubble-text">{{text}}</div>' +
        '</div>' +
        '{{#actions}}<button class="bubble-btn" data-action="{{id}}">{{label}}</button>{{/actions}}' +
        '<button class="bubble-close-min" data-action="close">✕</button>' +
      '</div>',
    css:
      '.colorful-bubble { background: linear-gradient(135deg, #fef3c7, #fde68a); border-left: 4px solid var(--bubble-accent, #f59e0b); border-radius: 10px; padding: 10px 12px; height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 8px; }' +
      '.colorful-bubble .bubble-icon { font-size: 20px; }' +
      '.colorful-bubble .bubble-content { flex: 1; min-width: 0; }' +
      '.colorful-bubble .bubble-title { font-weight: 700; font-size: 13px; color: #92400e; margin-bottom: 2px; }' +
      '.colorful-bubble .bubble-text { font-size: 12px; color: #78350f; line-height: 1.3; }' +
      '.colorful-bubble .bubble-btn { background: var(--bubble-accent, #f59e0b); color: white; border: none; border-radius: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer; }' +
      '.colorful-bubble .bubble-close-min { background: none; border: none; color: #92400e; font-size: 11px; cursor: pointer; padding: 0; }',
    fields: ['title', 'text', 'actions'],
  },
  {
    id: 'cloudia',
    name: 'Cloudia 卡片',
    // ponytail: 378×224 = 540×320 × 0.7 — shrunk proportionally because the
    // natural 540×320 read too large in the bubble tier. All inner CSS
    // values (padding / font-size / mascot / gap / radius) scaled by 0.7
    // to match. To tweak, change `size` AND the CSS values together.
    size: { width: 378, height: 224 },
    html:
      '<div class="cloudia-card">' +
        '<div class="cloudia-header">' +
          '<svg class="cloudia-mascot" width="40" height="30" viewBox="0 0 64 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<defs>' +
              '<linearGradient id="cloudGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
                '<stop offset="0%" stop-color="#ffffff"/>' +
                '<stop offset="50%" stop-color="#e6f0fa"/>' +
                '<stop offset="100%" stop-color="#f8e1d5"/>' +
              '</linearGradient>' +
            '</defs>' +
            '<path d="M16 40 C 4 40, 4 28, 12 24 C 14 16, 22 14, 26 16 C 30 6, 46 6, 52 14 C 60 16, 64 28, 56 36 C 54 40, 46 40, 40 40 Z" fill="url(#cloudGrad)" stroke="#8aa6c4" stroke-width="2.5" stroke-linejoin="round"/>' +
            '<path d="M 22 28 Q 24 25 26 28" stroke="#4a5568" stroke-width="2" stroke-linecap="round" fill="none"/>' +
            '<path d="M 40 28 Q 42 25 44 28" stroke="#4a5568" stroke-width="2" stroke-linecap="round" fill="none"/>' +
            '<ellipse cx="19" cy="32" rx="3.5" ry="2.5" fill="#ffb3c6" opacity="0.85"/>' +
            '<ellipse cx="47" cy="32" rx="3.5" ry="2.5" fill="#ffb3c6" opacity="0.85"/>' +
            '<path d="M 31 32 Q 33 35 35 32" stroke="#4a5568" stroke-width="2" stroke-linecap="round" fill="none"/>' +
          '</svg>' +
          '{{#title}}<h2 class="cloudia-title">{{title}}</h2>{{/title}}' +
        '</div>' +
        '<p class="cloudia-text">{{text}}</p>' +
        '{{#actions}}<div class="cloudia-actions"><button class="cloudia-btn" data-action="{{id}}">{{label}}</button></div>{{/actions}}' +
      '</div>',
    css:
      '.cloudia-card { position: absolute; inset: 6px; background: #fdfaef; border-radius: 22px; padding: 22px; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.6); font-family: "Quicksand", "Nunito", "M PLUS Rounded 1c", system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; overflow: hidden; display: flex; flex-direction: column; }' +
      '.cloudia-header { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; flex-shrink: 0; }' +
      '.cloudia-mascot { flex-shrink: 0; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.05)); }' +
      '.cloudia-title { margin: 0; color: #6c91bf; font-size: 21px; line-height: 25px; font-weight: 700; letter-spacing: -0.025em; }' +
      '.cloudia-text { margin: 0 0 22px; color: #3b4145; font-size: 15px; font-weight: 500; line-height: 1.4; flex: 1; }' +
      '.cloudia-actions { display: flex; gap: 8px; flex-shrink: 0; }' +
      '.cloudia-btn { flex: 1; display: block; text-align: center; border: none; border-radius: 9999px; background: linear-gradient(to right, #f7c2a5, #fba184); color: #ffffff; font-size: 17px; line-height: 22px; font-weight: 700; padding: 13px 0; cursor: pointer; box-shadow: 0 12px 24px -8px rgba(251,161,132,0.5); text-shadow: 0 2px 4px rgba(0,0,0,0.12); transition: transform 0.3s ease-out, box-shadow 0.3s ease-out; font-family: inherit; }' +
      '.cloudia-btn:hover { transform: scale(1.03); box-shadow: 0 25px 50px -12px rgba(251,161,132,0.4); }',
    fields: ['title', 'text', 'actions'],
  },
];

export function getTemplateById(id: string | undefined, templates: BubbleTemplate[]): BubbleTemplate {
  if (id) {
    const found = templates.find((t) => t.id === id);
    if (found) return found;
  }
  return templates.find((t) => t.id === 'default') ?? BUILT_IN_TEMPLATES[0];
}
