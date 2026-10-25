import type { SourceStatusReader } from '../../modules/opportunities/ports.js';

/** D-10: no automatic source exists yet and manual import is not a checked source. */
export const noSourcesYet: SourceStatusReader = {
  summary: () => ({ checked: 0, errors: [] }),
};
