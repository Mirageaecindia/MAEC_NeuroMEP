/**
 * #TASK-33 - writes the Revit exchange samples to docs/revit/samples:
 *   <sample>.json            the exchange package (what the Revit add-in reads)
 *   <sample>_project.json    the NeuroMEP project file it came from (Import File > Open project file)
 *
 *   npm run revit:samples -w @neuromep/web
 *   python -I docs/revit/placement_check.py docs/revit/samples/<sample>.json docs/Floor_plan_inputs
 */
import { serializeProject } from '@neuromep/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIT_SAMPLES } from './samples';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/revit/samples');
mkdirSync(out, { recursive: true });

for (const s of REVIT_SAMPLES) {
  const { project, exchange } = s.build();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed folder, sample names
  writeFileSync(join(out, `${s.file}.json`), `${JSON.stringify(exchange, null, 2)}\n`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed folder, sample names
  writeFileSync(join(out, `${s.file}_project.json`), serializeProject(project));
  const r = exchange.summary.results;
  console.log(
    `${s.file}: ${exchange.summary.components} components, ${exchange.summary.feeders} feeders, ${exchange.summary.risers} risers - results final ${r.final}, provisional ${r.provisional}, blocked ${r.blocked}, awaiting load ${r.awaitingLoad}, not run ${r.notRun}`,
  );
}
