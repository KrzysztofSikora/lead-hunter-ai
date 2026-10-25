import { OperatorProfile, PROFILE_SCHEMA_VERSION } from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import { EXAMPLE_PROFILE } from './example.js';
import type { ProfileRepository } from './ports.js';

export interface ProfileDeps {
  repository: ProfileRepository;
  clock: Clock;
}

export interface StoredProfile {
  profile: OperatorProfile;
  example: boolean;
  updatedAt: Date;
}

export interface ProfileService {
  ensureExample(): void;
  /** The single reader later slices use; stored JSON is validated on every read (D-10). */
  get(): StoredProfile;
  save(profile: OperatorProfile): StoredProfile;
}

export function createProfileService({ repository, clock }: ProfileDeps): ProfileService {
  const get = (): StoredProfile => {
    const row = repository.get();
    if (!row) throw new Error('operator profile row is missing');
    return {
      profile: OperatorProfile.parse(row.data),
      example: row.isExample,
      updatedAt: new Date(row.updatedAt),
    };
  };

  return {
    ensureExample() {
      repository.insertIfMissing({
        data: EXAMPLE_PROFILE,
        isExample: true,
        updatedAt: clock.now().getTime(),
        schemaVersion: PROFILE_SCHEMA_VERSION,
      });
    },
    get,
    save(profile) {
      repository.upsert({
        data: profile,
        isExample: false,
        updatedAt: clock.now().getTime(),
        schemaVersion: PROFILE_SCHEMA_VERSION,
      });
      return get();
    },
  };
}
