export type StoredRow = Record<string, unknown>;

const FAILED = Symbol('unparsable');

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return FAILED;
  }
};

const isoOrSame = (value: number): number | string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

/**
 * S-15 D-8: one stored row as the export shows it. Epoch-ms columns named `…At` become ISO 8601
 * UTC strings, `…Json` text columns are parsed and named without the suffix, `null` stays `null`.
 */
export function toExportRow(row: StoredRow): StoredRow {
  const out: StoredRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('At') && typeof value === 'number') {
      out[key] = isoOrSame(value);
    } else if (key.endsWith('Json') && key.length > 4 && typeof value === 'string') {
      const parsed = parseJson(value);
      // Bad JSON stays the raw string under the original key rather than being dropped.
      if (parsed === FAILED) out[key] = value;
      else out[key.slice(0, -4)] = parsed;
    } else {
      out[key] = value;
    }
  }
  return out;
}
