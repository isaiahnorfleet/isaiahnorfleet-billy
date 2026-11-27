// Copied verbatim from Norfleet One (norfleet-crm app/src/domain/connectSigning.ts, sha256 2aca7b258ea379bdff556ec5d9e4beb6e61836da6b70ef9cdd7ef4f5caab5e70).
// Keep it identical: tests/unit/connect-signing.test.ts checks the shared test vector.
/**
 * Norfleet Connect request signing (Release 11B, L-06; docs/release-11/INTEGRATION-SECURITY.md).
 *
 * Key format: "nck_<key id>_<secret>", key id 8–16 lowercase letters/digits, secret 43 base64url characters (256 bits).
 * Each request carries x-norfleet-key-id, x-norfleet-timestamp (Unix seconds), x-norfleet-nonce and
 * x-norfleet-signature = base64url(HMAC-SHA256(secret, canonical)), where canonical is
 *   METHOD \n path \n sorted query \n timestamp \n nonce \n hex(sha256(body))
 * Providers verify with verifyConnectRequest (the same code, copied into their repos in 11C/11D with this file's checksum).
 * Web Crypto only: runs the same in the browser, Node 20+ and Deno.
 */

export const KEY_FORMAT = /^nck_([a-z0-9]{8,16})_([A-Za-z0-9_-]{43})$/;
export const MAX_SKEW_SEC = 300;

export interface ConnectKey { keyId: string; secret: string; hint: string }

export function parseConnectKey(raw: string): ConnectKey | null {
  const m = KEY_FORMAT.exec((raw || '').trim());
  return m ? { keyId: m[1], secret: m[2], hint: m[1].slice(-4) } : null;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(data: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Query string with parameters sorted by name then value, each encoded with encodeURIComponent. */
export function sortedQuery(search: string | URLSearchParams): string {
  const p = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  return [...p.entries()].sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

export async function canonicalString(method: string, path: string, query: string, timestamp: string, nonce: string, body: string): Promise<string> {
  return [method.toUpperCase(), path, sortedQuery(query), timestamp, nonce, await sha256Hex(body)].join('\n');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return b64url(b.buffer);
}

export interface SignInput { method: string; url: string; body?: string; key: ConnectKey; nowSec?: number; nonce?: string }

/** Headers for one signed request (plus accept-version). The secret never leaves this function. */
export async function signConnectRequest(i: SignInput): Promise<Record<string, string>> {
  const u = new URL(i.url);
  const ts = String(i.nowSec ?? Math.floor(Date.now() / 1000));
  const nonce = i.nonce ?? newNonce();
  const canon = await canonicalString(i.method, u.pathname, u.search, ts, nonce, i.body ?? '');
  return {
    'x-norfleet-key-id': i.key.keyId,
    'x-norfleet-timestamp': ts,
    'x-norfleet-nonce': nonce,
    'x-norfleet-signature': await hmac(i.key.secret, canon),
    'accept-version': '1',
  };
}

/** Constant-time comparison of two strings of public length. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length || !a) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export interface VerifyInput {
  method: string; url: string; body: string; headers: { get(name: string): string | null };
  /** Looks up the secret for a key id: null when unknown, revoked or expired. */
  secretFor(keyId: string): Promise<string | null>;
  /** True when the nonce was already used in the last 10 minutes (and records it otherwise). */
  seenNonce(keyId: string, nonce: string): Promise<boolean>;
  nowSec?: number;
}

/** Provider side. Any failure is just "unauthorized": which check failed is never told to the caller. */
export async function verifyConnectRequest(v: VerifyInput): Promise<{ ok: true; keyId: string } | { ok: false }> {
  const keyId = v.headers.get('x-norfleet-key-id') || '';
  const ts = v.headers.get('x-norfleet-timestamp') || '';
  const nonce = v.headers.get('x-norfleet-nonce') || '';
  const sig = v.headers.get('x-norfleet-signature') || '';
  if (!/^[a-z0-9]{8,16}$/.test(keyId) || !/^\d{9,11}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !sig) return { ok: false };
  const now = v.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > MAX_SKEW_SEC) return { ok: false };
  const secret = await v.secretFor(keyId);
  if (!secret) return { ok: false };
  const u = new URL(v.url);
  const want = await hmac(secret, await canonicalString(v.method, u.pathname, u.search, ts, nonce, v.body));
  if (!sameString(want, sig)) return { ok: false };
  if (await v.seenNonce(keyId, nonce)) return { ok: false };
  return { ok: true, keyId };
}
