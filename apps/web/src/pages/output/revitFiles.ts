import { loadSummaries, revitExchange, type Floor, type Project } from '@neuromep/shared';
import { calcDefault, lengthRule, powerFactors } from '../../workspace/projectDefaults';
import { safeFileName } from '../../workspace/fileNames';

/**
 * Output > Revit Exchange (JSON) (user request 25 Nov 2026): one `neuromep-revit-exchange` file
 * per ticked floor for the Revit plug-in - every component of the floor with its placement,
 * engineering properties, load and last Cable Size result, its feeders (plan feeders and those
 * between floors with an end on it) and the risers serving it. Built from the project after the
 * Cable Size run of the download (#TASK-33).
 */
export interface RevitFile {
  floor: Floor;
  name: string;
  json: string;
  components: number;
}

export function revitFiles(
  p: Project,
  floorIds: ReadonlySet<string>,
  args: {
    version: number;
    generatedAt: string;
    engineVersion?: string;
    /** /Rotate of each floor's plan page, read from the PDF where it could be read. */
    pageRotationDeg?: Record<string, number>;
  },
): RevitFile[] {
  const pfs = powerFactors(p);
  const base = safeFileName(p.details.name) || 'NeuroMEP';
  const common = {
    summaries: loadSummaries(p, pfs),
    length: lengthRule(p) ?? { allowancePct: 0, additionM: null },
    powerFactors: pfs,
    targetPf: calcDefault(p, 'targetPowerFactor'),
    generatedAt: args.generatedAt,
    ...(args.engineVersion ? { engineVersion: args.engineVersion } : {}),
    ...(args.pageRotationDeg ? { pageRotationDeg: args.pageRotationDeg } : {}),
  };
  return p.building.floors
    .filter((f) => floorIds.has(f.id))
    .map((floor) => {
      const x = revitExchange(p, { ...common, floorIds: [floor.id] });
      return {
        floor,
        name: `${base}_${safeFileName(floor.code) || 'floor'}_RevitExchange_v${args.version}.json`,
        json: `${JSON.stringify(x, null, 2)}\n`,
        components: x.summary.components,
      };
    });
}

/**
 * The /Rotate of each floor's plan PDF (the sheet is shown turned; the coordinates are not): the
 * Revit add-in needs it to place the plan. Floors sharing a plan (typical floors) read it once; a
 * plan that cannot be read is left out (the file then says null).
 */
export async function planRotations(
  floors: readonly Floor[],
  download: (fileId: string) => Promise<ArrayBuffer>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byFile = new Map<string, Promise<number | null>>();
  const { openPdf } = await import('../../viewer/pdf');
  for (const f of floors) {
    if (f.plan?.kind !== 'pdf') continue;
    const fileId = f.plan.fileId;
    if (!byFile.has(fileId)) {
      byFile.set(
        fileId,
        (async () => {
          try {
            const doc = await openPdf(await download(fileId));
            const page = await doc.getPage(1);
            return typeof page.rotate === 'number' ? page.rotate : null;
          } catch {
            return null;
          }
        })(),
      );
    }
    const deg = await byFile.get(fileId)!;
    if (deg !== null) out[f.id] = deg;
  }
  return out;
}
