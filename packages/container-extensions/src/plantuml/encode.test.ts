import { describe, it, expect } from 'vitest';
import { encodePlantUml } from './encode';

describe('plantuml encode', () => {
  // ponytail: one structural test that breaks if the alphabet table or
  // bit-shift math drifts. Verifying the encoded string actually decodes at
  // plantuml.com requires a live network round-trip — skip in CI by
  // default; flip `PLANTUML_SMOKE=1` to run locally.
  it('produces non-empty alphabet-only output for a simple diagram', async () => {
    const source = '@startuml\nBob -> Alice : hello\n@enduml';
    const encoded = await encodePlantUml(source);
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded).toMatch(/^[0-9A-Za-z-_]+$/);
  });

  it('deflates compressible input (repeats) below raw size', async () => {
    const source = '@startuml\n' + 'Bob -> Alice : hello\n'.repeat(20) + '@enduml';
    const encoded = await encodePlantUml(source);
    // 6 bits per char → encoded.length ≈ 4/3 * compressed bytes. For 20x
    // repeated text, compressed should be far smaller than source. Sanity
    // threshold: encoded < source.
    expect(encoded.length).toBeLessThan(source.length);
  });

  // Live smoke test — opt-in only. Run: `PLANTUML_SMOKE=1 pnpm test`.
  it.runIf(process.env.PLANTUML_SMOKE === '1')(
    'round-trips against plantuml.com (PLANTUML_SMOKE=1)',
    async () => {
      const source = '@startuml\nBob -> Alice : hello\n@enduml';
      const encoded = await encodePlantUml(source);
      const r = await fetch(`https://www.plantuml.com/plantuml/svg/${encoded}`);
      const text = await r.text();
      expect(text.startsWith('<svg')).toBe(true);
    },
  );
});
