import type { Clock } from '../shared/clock.js';
import { startOfWarsawMonth } from '../shared/warsaw-day.js';
import type { DataRepository } from './ports.js';

export interface DataDeps {
  repository: DataRepository;
  clock: Clock;
}

export interface DataService {
  /** False when the opportunity does not exist. */
  deleteOpportunity(id: number): boolean;
}

export function createDataService(deps: DataDeps): DataService {
  return {
    deleteOpportunity: (id) =>
      deps.repository.deleteOpportunity(id, startOfWarsawMonth(deps.clock.now()).getTime()),
  };
}
