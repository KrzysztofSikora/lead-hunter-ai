/** Micro-USD (integer) to a Polish-formatted USD amount; sub-cent calls keep four decimals. */
export function formatUsd(microUsd: number): string {
  return (microUsd / 1_000_000).toLocaleString('pl-PL', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}
