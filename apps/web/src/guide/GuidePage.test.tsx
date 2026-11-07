import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CATALOGUE, LIBRARY_ITEMS } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { GuidePage } from './GuidePage';
import { SECTION_OF_PAGE } from './openGuide';
import { SECTIONS } from './sections';

/** The user guide behind the Help button (user request 7 Nov 2026). */
describe('#TASK-32 user guide', () => {
  it('has a section for every page Help opens, and lists every component and error code', () => {
    render(<GuidePage />);
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const id of Object.values(SECTION_OF_PAGE)) expect(ids).toContain(id);
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    const components = document.getElementById('components')!;
    for (const item of LIBRARY_ITEMS) {
      expect(within(components).getByRole('rowheader', { name: item.label })).toBeInTheDocument();
    }
    const errors = document.getElementById('errors')!;
    for (const e of ERROR_CATALOGUE) {
      expect(within(errors).getByRole('rowheader', { name: e.code })).toBeInTheDocument();
    }
  }, 40_000);

  it('every internal link points at a section of the guide', () => {
    render(<GuidePage />);
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(anchors.length).toBeGreaterThan(20);
    for (const a of anchors) {
      expect([a.getAttribute('href'), document.getElementById(a.hash.slice(1))]).not.toEqual([
        a.getAttribute('href'),
        null,
      ]);
    }
  });

  it('search keeps only the sections containing every word', async () => {
    render(<GuidePage />);
    await userEvent.type(screen.getByLabelText('Search the guide'), 'riser cost');
    const contents = screen.getByRole('navigation', { name: 'Contents' });
    const titles = within(contents)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(titles).toContain('Risers and riser cost');
    expect(titles).not.toContain('Glossary');
    expect(document.getElementById('glossary')).not.toBeVisible();
    await userEvent.clear(screen.getByLabelText('Search the guide'));
    await userEvent.type(screen.getByLabelText('Search the guide'), 'zzqqxx');
    expect(screen.getByText(/Nothing in the guide matches/)).toBeInTheDocument();
  });

  it('a Calculation button works the example through and verifies it against the engine', async () => {
    render(<GuidePage />);
    const section = document.getElementById('calc-ib')!;
    const [first] = within(section).getAllByRole('button', { name: /Calculation/ });
    await userEvent.click(first!);
    const region = await within(section).findByRole('region', { name: 'Calculation ib-three' });
    expect(
      await within(region).findByText('Design current Ib - balanced three-phase load'),
    ).toBeInTheDocument();
    const verdicts = within(region).getAllByText(/agree|differ/);
    expect(verdicts.map((v) => v.textContent)).toEqual(['✓ agree']);
    await userEvent.click(first!);
    expect(within(section).queryByRole('region')).toBeNull();
  });
});
