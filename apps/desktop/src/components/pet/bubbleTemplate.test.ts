import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  sanitizeBubbleHtml,
  getTemplateById,
  BUILT_IN_TEMPLATES,
  type BubbleTemplate,
} from './bubbleTemplate';
import type { PetBubblePayload } from './PetBubbleApp';

const basePayload: PetBubblePayload = {
  text: 'hi',
  title: 'Title',
  kind: 'info',
};

describe('renderTemplate — scalar', () => {
  it('substitutes top-level scalars', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '<div>{{text}}</div>',
      css: '',
    };
    expect(renderTemplate(tpl, basePayload)).toBe('<div>hi</div>');
  });

  it('substitutes dotted paths', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '<div>{{data.repo}} #{{data.runId}}</div>',
      css: '',
    };
    const payload = {
      ...basePayload,
      data: { repo: 'folyn', runId: 42 },
    } as PetBubblePayload;
    expect(renderTemplate(tpl, payload)).toBe('<div>folyn #42</div>');
  });

  it('HTML-escapes scalar values', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '<div>{{text}}</div>',
      css: '',
    };
    const payload = { ...basePayload, text: '<b>bold</b> & "quotes"' };
    const out = renderTemplate(tpl, payload);
    expect(out).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;quotes&quot;');
    expect(out).not.toContain('<b>');
  });

  it('renders empty for missing dotted path', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '<div>{{data.missing}}</div>',
      css: '',
    };
    expect(renderTemplate(tpl, basePayload)).toBe('<div></div>');
  });
});

describe('renderTemplate — blocks', () => {
  it('iterates array blocks, capping at 2', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '{{#actions}}<button data-action="{{id}}">{{label}}</button>{{/actions}}',
      css: '',
    };
    const payload = {
      ...basePayload,
      actions: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    } as PetBubblePayload;
    const out = renderTemplate(tpl, payload);
    expect(out).toBe(
      '<button data-action="a">A</button><button data-action="b">B</button>',
    );
  });

  it('renders truthy scalar block once', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '{{#title}}<h>{{title}}</h>{{/title}}',
      css: '',
    };
    expect(renderTemplate(tpl, basePayload)).toBe('<h>Title</h>');
  });

  it('drops falsy scalar block', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '{{#title}}<h>{{title}}</h>{{/title}}',
      css: '',
    };
    expect(renderTemplate(tpl, { text: 'x' })).toBe('');
  });

  it('drops block when list is empty array', () => {
    const tpl: BubbleTemplate = {
      id: 't',
      name: 't',
      html: '{{#actions}}<btn>{{label}}</btn>{{/actions}}',
      css: '',
    };
    expect(renderTemplate(tpl, { ...basePayload, actions: [] })).toBe('');
  });
});

describe('sanitizeBubbleHtml', () => {
  it('strips <script>', () => {
    const out = sanitizeBubbleHtml('<div>ok</div><script>alert(1)</script>');
    expect(out).toContain('<div>ok</div>');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  it('strips on* attributes', () => {
    const out = sanitizeBubbleHtml('<div onclick="alert(1)">x</div>');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('strips <iframe>', () => {
    const out = sanitizeBubbleHtml('<iframe src="x"></iframe>');
    expect(out.toLowerCase()).not.toContain('iframe');
  });

  it('preserves data-action attributes', () => {
    const out = sanitizeBubbleHtml('<button data-action="view">V</button>');
    expect(out).toContain('data-action="view"');
  });
});

describe('getTemplateById', () => {
  it('returns the named template', () => {
    expect(getTemplateById('default', BUILT_IN_TEMPLATES).id).toBe('default');
  });

  it('falls back to default when id is missing', () => {
    expect(getTemplateById('nope', BUILT_IN_TEMPLATES).id).toBe('default');
  });

  it('falls back to default when id is undefined', () => {
    expect(getTemplateById(undefined, BUILT_IN_TEMPLATES).id).toBe('default');
  });
});

describe('built-in templates', () => {
  // Smoke: each built-in renders without throwing and yields an HTML string
  // containing the payload text. Regression safety for the 5 presets.
  for (const tpl of BUILT_IN_TEMPLATES) {
    it(`${tpl.id} renders payload text`, () => {
      const out = renderTemplate(tpl, basePayload);
      expect(out).toContain('hi');
      expect(out.length).toBeGreaterThan(0);
    });

    it(`${tpl.id} html sanitizes clean`, () => {
      const out = sanitizeBubbleHtml(renderTemplate(tpl, basePayload));
      expect(out.toLowerCase()).not.toContain('<script');
      expect(out.toLowerCase()).not.toContain('onclick');
    });
  }
});
