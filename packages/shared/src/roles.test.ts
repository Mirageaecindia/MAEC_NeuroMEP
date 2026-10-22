import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, RoleSchema } from './index.js';

describe('roles', () => {
  it('defines the six roles of design doc Section 2, each with a label', () => {
    expect(RoleSchema.options).toHaveLength(6);
    for (const role of RoleSchema.options) expect(ROLE_LABELS[role]).toBeTruthy();
  });

  it('rejects an unknown role', () => {
    expect(RoleSchema.safeParse('GUEST').success).toBe(false);
  });
});
