/**
 * NeuroMEP calculation engine (design doc Section 10, layer 04).
 *
 * Runs as a background service: in a web worker for live results and in the api.
 * It receives the network model and a rule-pack version and returns results.
 */
export const ENGINE_VERSION = '0.1.0';

export * from './design.js';
export * from './capacity.js';
export * from './checks.js';
export * from './busbar.js';
export * from './shortCircuit.js';
export * from './duty.js';
export * from './protection.js';
export * from './autosize.js';
export * from './cableSize.js';
export * from './results.js';
