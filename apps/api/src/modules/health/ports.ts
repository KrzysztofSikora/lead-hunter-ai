export interface HealthProbe {
  check(): { ok: boolean; migrations: number };
}
