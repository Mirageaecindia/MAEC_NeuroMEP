import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REVIT_SAMPLES } from './samples';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/revit/samples');

describe('#TASK-33 Revit exchange samples on the DCH-F14 sheets (user request 12 Nov 2026)', () => {
  it.each(REVIT_SAMPLES)('$file: sized with nothing blocked or failing', ({ build }) => {
    const { exchange } = build();
    expect(exchange.summary.results.blocked).toBe(0);
    const items = [...exchange.components, ...exchange.feeders];
    const bad = items.flatMap((x) =>
      Object.entries(x.result?.checks ?? {})
        .filter(([, c]) => c.state === 'fail' || c.state === 'warning')
        .map(([code]) => `${x.tag} ${code}`),
    );
    expect(bad).toEqual([]);
    // Every component on a plan has its PDF point; GF has no plan.
    for (const c of exchange.components) {
      const onPlan = exchange.floors.find((f) => f.id === c.floorId)?.plan;
      expect(c.placement.pdf === null).toBe(!onPlan);
    }
  });

  it.each(REVIT_SAMPLES)(
    '$file: docs/revit/samples holds the current package (else: npm run revit:samples -w @neuromep/web)',
    ({ file, build }) => {
      const stored = readFileSync(join(dir, `${file}.json`), 'utf-8');
      expect(stored).toBe(`${JSON.stringify(build().exchange, null, 2)}\n`);
    },
  );
});
