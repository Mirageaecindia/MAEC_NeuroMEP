import { describe, expect, it } from 'vitest';
import {
  CODE_ALIASES,
  currentCode,
  ERROR_CATALOGUE,
  errorText,
  isWarningCode,
} from './catalogue.js';

// Appendix D of the design document, in order.
const APPENDIX_D = [
  'E0601',
  'E0701',
  'W0801',
  'W0902',
  'E1001',
  'E1301',
  'E1401',
  'E1501',
  'E1502',
  'W1503',
  'W1801',
  'W1802',
  'W1803',
  'W1901',
  'E2001',
  'E2002',
  'E2101',
  'E2102',
  'E2301',
  'W2402',
  'E2601',
  'W2690',
  'W2701',
  'W2702',
  'W2801',
  'W2802',
  'E3101',
];

describe('#TASK-32 error catalogue', () => {
  it('lists every code once: W + task + sequence for warnings, E for the others (A-26)', () => {
    const codes = ERROR_CATALOGUE.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const x of ERROR_CATALOGUE) {
      expect(x.code).toMatch(x.effect === 'warning' ? /^W\d{4}$/ : /^E\d{4}$/);
      expect(x.task).toBe(`#TASK-${x.code.slice(1, 3)}`);
      expect(x.message && x.cause && x.action).toBeTruthy();
    }
  });

  it('contains the 27 engineer-facing errors of Appendix D (22 + 5 added by A-16)', () => {
    expect(ERROR_CATALOGUE.filter((x) => x.appendixD).map((x) => x.code)).toEqual(APPENDIX_D);
  });

  it('reads the old E form of a warning as its W code (A-26)', () => {
    expect(CODE_ALIASES.E2701).toBe('W2701');
    expect(currentCode('E2701')).toBe('W2701');
    expect(currentCode('E2003')).toBe('E2003'); // an error keeps its code
    expect(isWarningCode('E1901')).toBe(true);
    expect(isWarningCode('E2102')).toBe(false);
    expect(Object.keys(CODE_ALIASES)).toHaveLength(15);
  });

  it('formats a message with its code', () => {
    expect(errorText('E0802')).toBe('Someone else saved this project since you opened it (E0802)');
  });
});
