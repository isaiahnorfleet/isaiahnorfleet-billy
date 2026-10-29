/**
 * Validate a provider/payment URL. Only http(s) is allowed; credentials in the URL are rejected.
 * Returns a normalized URL string or null.
 */
export function normalizePaymentUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (raw === "") return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes(".")) return null;
  if (url.href.length > 2048) return null;
  return url.href;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
