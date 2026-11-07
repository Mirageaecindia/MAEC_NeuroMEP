import { sldTree, type Element } from '@neuromep/shared';
import { completeProject, testCable, testElement } from '@neuromep/shared/testing';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SldDiagram } from './SldDiagram';

describe('Schematic as a tree (manager feedback, 7 Nov 2026)', () => {
  it('draws Tx > EMDB > ESMDB > EDB / UDB, with the generator as a second incomer of the EMDB', () => {
    const p = completeProject();
    const el = (key: string, id: string, tag: string, kind?: Element['kind']) =>
      ({ ...testElement(key, id), tag, ...(kind && { kind }) }) as Element;
    const tx = el('transformer', 'tx', 'Tx_GF_1');
    const gen = el('generator', 'gen', 'Gen_GF_1');
    const emdb = el('mdb', 'emdb', 'EMDB-P1-GF-LL-01', 'emdb');
    const esmdb = el('smdb', 'esmdb', 'ESMDB-P1-GF-01', 'esmdb');
    const edb = el('db', 'edb', 'EDB-P1-GF-LV-01');
    const udb = el('db', 'udb', 'UDB-P1-GF-SEC-01');
    p.model.elements = [tx, gen, emdb, esmdb, edb, udb];
    p.model.cables = [
      testCable(tx, emdb),
      testCable(gen, emdb),
      testCable(emdb, esmdb),
      testCable(esmdb, edb),
      testCable(esmdb, udb),
    ];
    const tree = sldTree(p.model, 'tx')!;
    expect(tree.children.map((c) => c.element.tag)).toEqual(['EMDB-P1-GF-LL-01']);
    const e = tree.children[0]!;
    expect(e.incomers.map((i) => i.from.tag)).toEqual(['Gen_GF_1']);
    expect(e.children.map((c) => c.element.tag)).toEqual(['ESMDB-P1-GF-01']);
    expect(e.children[0]!.children.map((c) => c.element.tag)).toEqual([
      'EDB-P1-GF-LV-01',
      'UDB-P1-GF-SEC-01',
    ]);

    render(<SldDiagram project={p} tree={tree} zoom={1} />);
    const svg = screen.getByRole('img', { name: 'Single-line diagram from Tx_GF_1' });
    expect(within(svg).getByRole('group', { name: 'EMDB-P1-GF-LL-01 (EMDB)' })).toBeInTheDocument();
    expect(
      within(svg).getByRole('group', { name: 'EMDB-P1-GF-LL-01 also fed from Gen_GF_1' }),
    ).toBeInTheDocument();
    // The ESMDB sits a level below the EMDB, the DBs a level below the ESMDB.
    const y = (name: string) =>
      Number(within(svg).getByRole('group', { name }).querySelector('rect')!.getAttribute('y'));
    expect(y('ESMDB-P1-GF-01 (ESMDB)')).toBeGreaterThan(y('EMDB-P1-GF-LL-01 (EMDB)'));
    expect(y('EDB-P1-GF-LV-01 (DB)')).toBeGreaterThan(y('ESMDB-P1-GF-01 (ESMDB)'));
  });
});
