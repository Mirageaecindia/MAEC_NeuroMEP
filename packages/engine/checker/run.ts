/**
 * WBS 1.6.8 - independent checker. Builds seeded random buildings (the same generator as the
 * engine's random-network tests), runs Cable Size, writes the inputs and the engine's results to
 * JSON and hands them to `check_engine.py`. The Python checker recomputes length, Ib, In, Iz (C1),
 * voltage drop (C2), the DEWA minimum (C6) and Ik"max with its own code, straight from the
 * CableSizer source rules (docs/reference) and the rule-pack JSON - no engine code is shared.
 *
 *   npm run check:independent -w @neuromep/engine            # 200 buildings
 *   npm run check:independent -w @neuromep/engine -- 1000    # more
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cableSize } from '../src/cableSize.js';
import { randomBuilding } from '../src/fixtures/network.js';

const here = dirname(fileURLToPath(import.meta.url));
const count = Number(process.argv[2] ?? 200);

const buildings = Array.from({ length: count }, (_, seed) => {
  const { project } = randomBuilding(seed + 1);
  const run = cableSize(project);
  return {
    seed: seed + 1,
    site: {
      airC: project.site.ambientAirC.value,
      groundC: project.site.ambientSoilC.value,
      soilResistivity: project.site.soilResistivity.value,
    },
    upstreamFaultMva: project.calculation.upstreamFaultMva,
    overrides: project.calculation.defaultOverrides,
    demandFactors: project.calculation.demandFactors,
    elements: project.model.elements.map((e) => ({
      id: e.id,
      kind: e.kind,
      kva: 'kva' in e ? e.kva : null,
      ukPct: 'ukPct' in e ? e.ukPct : null,
      urPct: 'urPct' in e ? e.urPct : null,
      primaryV: 'primaryV' in e ? e.primaryV : null,
      powerFactor: 'powerFactor' in e ? e.powerFactor : null,
      loads: 'loads' in e ? e.loads : [],
    })),
    cables: project.model.cables.map((c) => ({
      id: c.id,
      from: c.from.elementId,
      to: c.to.elementId,
      route: c.route,
      verticalM: c.verticalM,
      construction: c.construction,
    })),
    results: run.feeders.map((f) => ({
      cableId: f.cableId,
      status: f.status,
      ibA: f.ibA,
      inA: f.device?.ratingA ?? null,
      lengthM: f.lengthM,
      sizeMm2: f.size?.sizeMm2 ?? null,
      runs: f.size?.runs ?? null,
      izA: f.rating?.izA ?? null,
      vdOwnPct: f.drop?.vcPct ?? null,
      vdTotalPct: f.vdTotalPct,
      vdLimitPct: f.vdLimitPct,
      c1: f.c1,
      c2: f.c2,
      ikMaxAtBreakerKa: f.faultAtBreaker?.ikMaxKa ?? null,
    })),
  };
});

const file = join(mkdtempSync(join(tmpdir(), 'neuromep-checker-')), 'engine-results.json');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- our own temporary folder
writeFileSync(file, JSON.stringify(buildings));
const root = resolve(here, '../../..');
const args = [join(here, 'check_engine.py'), file, root];
// `python` on Windows (`python3` there is the Store alias), `python3` on Linux / macOS.
const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', args, {
  stdio: 'inherit',
});
if (py.error) {
  console.error('Python 3 is needed for the independent checker.');
  process.exit(2);
}
process.exit(py.status ?? 1);
