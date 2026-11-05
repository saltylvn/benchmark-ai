import type { Minute } from "./types.js";

export const WORK_START = 8 * 60 + 30;
export const WORK_END = 17 * 60 + 30;
export const MORNING_START = 9 * 60;
export const MORNING_END = 12 * 60;
/** Leave this much air before every fixed meeting so the day can breathe. */
export const FIXED_LEAD_MINUTES = 10;

export function hm(minutes: Minute): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function range(start: Minute, end: Minute): string {
  return `${hm(start)}–${hm(end)}`;
}

export function clockLabel(minutes: Minute, seconds: number): string {
  const total = minutes * 60 + seconds;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function durationLabel(start: Minute, end: Minute): string {
  const minutes = end - start;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
