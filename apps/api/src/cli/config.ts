import { ConfigError, loadConfig, type Config } from '@lead-hunter/config';

/** Loads the config for a command-line entry point; on error prints the Polish message and exits 1. */
export function loadConfigOrExit(env: Record<string, string | undefined> = process.env): Config {
  try {
    return loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
