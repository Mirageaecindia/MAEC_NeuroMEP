import { z } from 'zod';

/**
 * A riser of the Building tab "Riser Design" (FR-20, A-05): drawn on the left of the Building
 * view; its length and width are typed in metres (no floor heights). Part of the electrical
 * network model. Tap-offs to floors and the source connection follow in WBS 1.4.2 (#TASK-18).
 */
export const RiserSchema = z.object({
  id: z.string().min(1),
  lengthM: z.number().positive().nullable(),
  widthM: z.number().positive().nullable(),
});
export type Riser = z.infer<typeof RiserSchema>;

/** Rows of the Riser Design table (Figma 3.5 - 3.8). */
export const RISER_ROWS = 3;

/** The Riser Design rows: the stored risers, padded with empty ones up to RISER_ROWS. */
export function riserRows(risers: readonly Riser[]): Riser[] {
  const rows = [...risers];
  for (let i = rows.length; i < RISER_ROWS; i++) {
    rows.push({ id: `riser-${i + 1}`, lengthM: null, widthM: null });
  }
  return rows;
}
