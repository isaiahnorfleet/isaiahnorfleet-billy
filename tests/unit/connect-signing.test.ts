import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConnectKey, signConnectRequest, verifyConnectRequest } from "@/lib/connect/signing";

const KEY = parseConnectKey("nck_abcd1234efgh_" + "A".repeat(43))!;

describe("Norfleet Connect signing (copied from Norfleet One)", () => {
  it("is the exact copy named in its header", () => {
    const text = readFileSync(path.join(__dirname, "../../src/lib/connect/signing.ts"), "utf8");
    const [first, second, ...rest] = text.split("\n");
    const sha = /sha256 ([0-9a-f]{64})/.exec(first)?.[1];
    expect(second).toMatch(/Keep it identical/);
    expect(createHash("sha256").update(rest.join("\n")).digest("hex")).toBe(sha);
  });

  it("verifies its own signature once, and refuses tampering, old timestamps and unknown keys", async () => {
    const url = "https://billy.example.test/api/connect/v1/obligations?limit=5&cursor=occ_" + "a".repeat(32);
    const now = 1_800_000_000;
    const h = await signConnectRequest({ method: "GET", url, key: KEY, nowSec: now });
    const headers = new Headers(h);
    const base = { method: "GET", url, body: "", headers, secretFor: async (id: string) => (id === KEY.keyId ? KEY.secret : null), seenNonce: async () => false, nowSec: now };
    expect(await verifyConnectRequest(base)).toEqual({ ok: true, keyId: KEY.keyId });
    // Query order doesn't matter; a changed value does.
    expect((await verifyConnectRequest({ ...base, url: "https://billy.example.test/api/connect/v1/obligations?cursor=occ_" + "a".repeat(32) + "&limit=5" })).ok).toBe(true);
    expect((await verifyConnectRequest({ ...base, url: url.replace("limit=5", "limit=6") })).ok).toBe(false);
    expect((await verifyConnectRequest({ ...base, nowSec: now + 301 })).ok).toBe(false);
    expect((await verifyConnectRequest({ ...base, secretFor: async () => null })).ok).toBe(false);
    expect((await verifyConnectRequest({ ...base, seenNonce: async () => true })).ok).toBe(false);
  });
});
