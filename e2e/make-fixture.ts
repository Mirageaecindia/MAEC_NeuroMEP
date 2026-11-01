/**
 * Writes the smoke-test project file: the shared test project (Ground Floor DB, complete Page 1)
 * plus a transformer TX-1, so the Building tab can connect a riser (A-07).
 * Run by global-setup with `tsx --conditions=source make-fixture.ts <out.json>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isPlaceable, libraryItem, placeElement, serializeProject } from '@neuromep/shared';
import { modelledProject } from '@neuromep/shared/testing';

const out = process.argv[2];
if (!out) throw new Error('Usage: make-fixture.ts <out.json>');
const p = modelledProject();
const gf = p.building.floors.find((f) => f.code === 'GF')!;
const item = libraryItem('transformer');
if (!item || !isPlaceable(item)) throw new Error('No transformer in the library');
const tx = placeElement(item, {
  id: 'tx',
  floorId: gf.id,
  floorCode: 'GF',
  position: { x: 2, y: 2 },
  taken: [],
});
p.model.elements.push({ ...tx, tag: 'TX-1' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serializeProject(p));
