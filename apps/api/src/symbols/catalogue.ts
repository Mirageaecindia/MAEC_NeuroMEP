import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Draft symbols shipped with the API (A-11); SYMBOLS_DIR can point at the approved set. */
export const DEFAULT_SYMBOLS_DIR = fileURLToPath(new URL('../../symbols/', import.meta.url));

const CatalogueSchema = z.object({
  note: z.string().optional(),
  symbols: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9-]+$/),
        cmpCode: z.string().regex(/^CMP-\d{3}$/),
        file: z.string().regex(/^[a-z0-9-]+\.svg$/),
        status: z.enum(['draft', 'approved']),
      }),
    )
    .min(1),
});

export interface LegendSymbol {
  key: string;
  cmpCode: string;
  status: 'draft' | 'approved';
  svg: string;
}

/**
 * Reads the symbol catalogue (A-11: legend symbols kept on the server, served to the library).
 * Refuses an SVG that could run code; the browser shows symbols as images anyway, where scripts
 * never run. Throws with the file name when something is wrong, so the API does not start.
 */
export function loadSymbols(dir: string = DEFAULT_SYMBOLS_DIR): LegendSymbol[] {
  // Paths come from the server configuration and file names checked by the schema.
  /* eslint-disable security/detect-non-literal-fs-filename */
  const catalogue = CatalogueSchema.parse(
    JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf8')),
  );
  return catalogue.symbols.map((s) => {
    const svg = readFileSync(join(dir, s.file), 'utf8').trim();
    if (!svg.startsWith('<svg') || /<script|\son[a-z]+\s*=|javascript:|<foreignObject/i.test(svg)) {
      throw new Error(`Symbol ${s.file} is not a plain SVG drawing.`);
    }
    return { key: s.key, cmpCode: s.cmpCode, status: s.status, svg };
  });
  /* eslint-enable security/detect-non-literal-fs-filename */
}
