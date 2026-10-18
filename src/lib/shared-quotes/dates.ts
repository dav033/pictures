import { ValidUntilSchema } from "./contracts";

export function todayInBogota(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function tomorrowInBogota(now: Date): string {
  const today = todayInBogota(now);
  const next = new Date(`${today}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function isFutureValidUntil(validUntil: string, now: Date): boolean {
  return ValidUntilSchema.safeParse(validUntil).success && validUntil > todayInBogota(now);
}

export function isNotExpired(validUntil: string, now: Date): boolean {
  return ValidUntilSchema.safeParse(validUntil).success && validUntil >= todayInBogota(now);
}
