import { defaultClientConditions, defaultServerConditions } from 'vite';

// Internal packages export TypeScript source under the "source" condition, so tests and the
// dev server run against src/ without building dist/ first.
export const sourceConditions = {
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: {
    resolve: { conditions: ['source', ...defaultServerConditions], externalConditions: ['source'] },
  },
};
