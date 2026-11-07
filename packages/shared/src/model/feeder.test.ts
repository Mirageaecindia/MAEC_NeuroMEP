import { describe, expect, it } from 'vitest';
import { migrateProjectData } from '../project/migrate.js';
import { modelledProject, testCable, testElement } from '../testing.js';
import { CableSchema } from './cable.js';

describe('#TASK-13 feeders: cable or busbar (decision 1 Nov 2026)', () => {
  it('a feeder is a cable unless chosen otherwise', () => {
    const f = (key: string, id: string) => testElement(key, id);
    const { feederType: _, ...stored } = testCable(f('mdb', 'm'), f('smdb', 's'));
    expect(CableSchema.parse(stored).feederType).toBe('cable');
  });

  it('busbar components stored earlier are dropped with their cables on load', () => {
    const p = modelledProject();
    const f = p.building.floors[0]!.id;
    const bb = { ...testElement('mdb', 'bb-1', f), kind: 'busbar' };
    p.model.elements.push(bb as never);
    p.model.cables.push({
      ...testCable(testElement('mdb', 'x', f), testElement('smdb', 'y', f)),
      from: { elementId: 'bb-1', port: 'out' },
    });
    const before = p.model.cables.length;
    const out = migrateProjectData(p) as typeof p;
    expect(out.model.elements.some((e) => e.id === 'bb-1')).toBe(false);
    expect(out.model.cables).toHaveLength(before - 1);
  });
});
