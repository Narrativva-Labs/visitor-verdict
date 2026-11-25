/** Shared publisher/cache shrink policy. Times are Unix seconds. */
export interface ShrinkCandidate {
  fingerprint: string;
  firstSeen: number;
}
export function prefixPolicy(
  count: number,
  previous: number | undefined,
  fingerprint: string,
  now: number,
  candidate?: ShrinkCandidate,
): { accept: boolean; candidate?: ShrinkCandidate } {
  if (!count) return { accept: false };
  if (previous === undefined || count >= previous / 2) return { accept: true };
  if (
    candidate?.fingerprint === fingerprint &&
    now >= candidate.firstSeen &&
    now - candidate.firstSeen >= 7200
  )
    return { accept: true };
  return {
    accept: false,
    candidate:
      candidate?.fingerprint === fingerprint && now >= candidate.firstSeen
        ? candidate
        : { fingerprint, firstSeen: now },
  };
}
