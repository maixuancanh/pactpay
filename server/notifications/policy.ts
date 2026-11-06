import { requireThat } from "../lib.js";
export function quietNow(
  timezone: string,
  start: number,
  end: number,
  now = new Date(),
) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}
export function validatePreferences(
  p: Record<string, any>,
  emailConfigured = false,
) {
  requireThat(
    typeof p.inApp === "boolean" && typeof p.email === "boolean",
    "invalid_preferences",
  );
  requireThat(
    !p.email || emailConfigured,
    "email_not_configured",
    undefined,
    503,
  );
  requireThat(typeof p.timezone === "string", "invalid_timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format();
  } catch {
    requireThat(false, "invalid_timezone");
  }
  requireThat(
    Number.isInteger(p.quietStart) &&
      p.quietStart >= 0 &&
      p.quietStart <= 23 &&
      Number.isInteger(p.quietEnd) &&
      p.quietEnd >= 0 &&
      p.quietEnd <= 23,
    "invalid_quiet_hours",
  );
  return p;
}
