import { describe, expect, it } from 'vitest';
import { ERROR_CATALOGUE, errorText } from './catalogue.js';

// Appendix D of the design document, in order.
const APPENDIX_D = [
  'E0601',
  'E0701',
  'E0801',
  'E0902',
  'E1001',
  'E1301',
  'E1401',
  'E1501',
  'E1502',
  'E1503',
  'E1801',
  'E1802',
  'E1901',
  'E2001',
  'E2002',
  'E2101',
  'E2102',
  'E2301',
  'E2402',
  'E2601',
  'E2690',
  'E2701',
  'E2702',
  'E2801',
  'E2802',
  'E3101',
];

describe('#TASK-32 error catalogue', () => {
  it('lists every code once, in the E + task + sequence format', () => {
    const codes = ERROR_CATALOGUE.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const x of ERROR_CATALOGUE) {
      expect(x.code).toMatch(/^E\d{4}$/);
      expect(x.task).toBe(`#TASK-${x.code.slice(1, 3)}`);
      expect(x.message && x.cause && x.action).toBeTruthy();
    }
  });

  it('contains the 26 engineer-facing errors of Appendix D (22 + 4 of A-16)', () => {
    expect(ERROR_CATALOGUE.filter((x) => x.appendixD).map((x) => x.code)).toEqual(APPENDIX_D);
  });

  it('formats a message with its code', () => {
    expect(errorText('E0802')).toBe('Someone else saved this project since you opened it (E0802)');
  });
});
