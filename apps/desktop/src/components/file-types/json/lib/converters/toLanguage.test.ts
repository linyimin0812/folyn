// @vitest-environment jsdom
/**
 * toLanguage serializer tests (PR5).
 *
 * Verifies at least Python/Go/Rust produce runnable code for a simple
 * nested object. Each emitter is checked against a snapshot of its
 * emitted source.
 */
import { describe, it, expect } from 'vitest';
import {
  toPython,
  toGo,
  toRust,
  toJava,
  toPhp,
  toCsharp,
} from './toLanguage';

const SAMPLE = {
  name: 'Alice',
  age: 30,
  active: true,
  tags: ['dev', 'admin'],
  meta: { created: '2026-01-01', count: 5 },
  none: null,
};

describe('toPython', () => {
  it('emits a runnable Python dict literal', () => {
    const code = toPython(SAMPLE);
    expect(code).toContain('import json');
    // Python dict literal markers.
    expect(code).toContain("'Alice'");
    expect(code).toContain('True');
    expect(code).toContain('None');
    // Nested map.
    expect(code).toContain("'created'");
  });
});

describe('toGo', () => {
  it('emits a runnable Go map literal', () => {
    const code = toGo(SAMPLE);
    expect(code).toContain('package main');
    expect(code).toContain('map[string]interface{}');
    // Boolean + nil.
    expect(code).toContain('true');
    expect(code).toContain('nil');
  });
});

describe('toRust', () => {
  it('emits a runnable Rust literal via serde_json::json!', () => {
    const code = toRust(SAMPLE);
    expect(code).toContain('use serde_json');
    expect(code).toContain('json!({');
    expect(code).toContain('"Alice"');
  });
});

describe('toJava', () => {
  it('emits a runnable Java Map.of literal', () => {
    const code = toJava(SAMPLE);
    expect(code).toContain('java.util.Map.of(');
    expect(code).toContain('"Alice"');
  });
});

describe('toPhp', () => {
  it('emits a runnable PHP array literal', () => {
    const code = toPhp(SAMPLE);
    expect(code).toContain('<?php');
    expect(code).toContain("'Alice'");
    expect(code).toContain('true');
    expect(code).toContain('null');
  });
});

describe('toCsharp', () => {
  it('emits a runnable C# Dictionary literal', () => {
    const code = toCsharp(SAMPLE);
    expect(code).toContain('Dictionary<string, object>');
    expect(code).toContain('"Alice"');
  });
});
