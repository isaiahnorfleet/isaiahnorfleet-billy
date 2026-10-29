/** Time zones offered in pickers: common North American zones first, then all IANA zones. */
export function timeZoneOptions(current: string): string[] {
  const common = ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/Regina", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "UTC"];
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  return [...new Set([current, ...common, ...all])];
}
