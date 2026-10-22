import raw from '../../cablesizer/lookup-tables.json' with { type: 'json' };
import { LookupTablesSchema } from './schema.js';

export * from './schema.js';
export * from './lookup.js';

/** CableSizer lookup tables, validated on load. */
export const cableSizerTables = LookupTablesSchema.parse(raw);
