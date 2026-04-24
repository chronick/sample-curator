/** Threshold (ms) under which a sample is visually flagged as "just recorded". */
export const FRESH_WINDOW_MS = 5 * 60 * 1000;

/** Produce a short "2m ago" / "3h ago" / "2d ago" string from an ISO timestamp. */
export function formatRelativeTime(
  isoTimestamp: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!isoTimestamp) return "-";
  const ts = Date.parse(isoTimestamp);
  if (Number.isNaN(ts)) return "-";
  const deltaMs = now - ts;
  if (deltaMs < 0) return "just now"; // clock skew — don't show future times
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

/** True if the sample was created within the last FRESH_WINDOW_MS. */
export function isFreshlyRecorded(
  isoTimestamp: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!isoTimestamp) return false;
  const ts = Date.parse(isoTimestamp);
  if (Number.isNaN(ts)) return false;
  return now - ts < FRESH_WINDOW_MS && now - ts >= 0;
}
