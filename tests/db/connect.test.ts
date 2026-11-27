// Norfleet One bridge (Release 11D): keys, the obligations feed and what never leaves Billy. Fictional data only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { sql, withUser } from "@/lib/db/client";
import { createBill, updateBill } from "@/lib/data/bills";
import { listOccurrencesForBill } from "@/lib/data/occurrences";
import { recordPayment } from "@/lib/data/payments";
import { handleConnect } from "@/lib/connect/api";
import { connectDb } from "@/lib/connect/db";
import { parseConnectKey, signConnectRequest, type ConnectKey } from "@/lib/connect/signing";
import { billInput, createUser, resetDb } from "./helpers";

const SCHEMA = JSON.parse(readFileSync(path.join(__dirname, "../../contracts/billy/obligations.v1.schema.json"), "utf8"));
const NOW = Date.parse("2026-11-27T15:00:00Z");
const BASE = "https://billy.example.test/api/connect/v1";

/** The flat checks the pinned schema uses: required, no extra fields, type, enum, pattern, min/max. */
function schemaProblem(r: Record<string, unknown>): string | null {
  for (const k of SCHEMA.required) if (!(k in r)) return "missing " + k;
  for (const [k, v] of Object.entries(r)) {
    const s = SCHEMA.properties[k];
    if (!s) return "extra " + k;
    const types: string[] = s.type ? [].concat(s.type) : [];
    const t = v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v;
    if (types.length && !types.includes(t) && !(t === "integer" && types.includes("number"))) return k + ":type";
    if (s.enum && !s.enum.includes(v)) return k + ":enum";
    if (typeof v === "string" && s.pattern && !new RegExp(s.pattern).test(v)) return k + ":pattern";
    if (typeof v === "number" && ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))) return k + ":range";
  }
  return null;
}

let user: { id: string };
let key: ConnectKey;
const as = <T,>(fn: Parameters<typeof withUser<T>>[1]) => withUser<T>(user.id, fn);

async function call(resource: "health" | "obligations", query = "", opts: { key?: ConnectKey; now?: number; headers?: Record<string, string> } = {}) {
  const url = `${BASE}/${resource}${query}`;
  const h = await signConnectRequest({ method: "GET", url, key: opts.key ?? key, nowSec: Math.floor((opts.now ?? NOW) / 1000) });
  const res = await handleConnect(new Request(url, { headers: { ...h, ...opts.headers } }), resource, connectDb, opts.now ?? NOW);
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  await resetDb();
  await sql()`truncate connect.keys, connect.nonces, vault.secrets`;
  user = await createUser();
  await as(async (tx) => {
    await createBill(tx, user.id, billInput({ name: "Adobe (fictional)", amount_minor: 8049, category: "subscription", due_date: "2026-11-03", autopay: true, business_use: "business", notes: "secret note", payment_url: "https://pay.example.test" }), "2026-11-01");
    await createBill(tx, user.id, billInput({ name: "Phone (fictional)", amount_minor: 10000, category: "phone_internet", due_date: "2026-11-10", business_use: "mixed", business_share_bp: 5000 }), "2026-11-01");
    await createBill(tx, user.id, billInput({ name: "Gym (fictional)", amount_minor: 4500, due_date: "2026-11-12", business_use: "personal" }), "2026-11-01");
    await createBill(tx, user.id, billInput({ name: "Hydro (fictional)", amount_minor: 11248, due_date: "2026-11-15" }), "2026-11-01");
  });
  const [r] = await as((tx) => tx<{ j: { key: string } }[]>`select public.connect_create_key() as j`);
  key = parseConnectKey(r.j.key)!;
});

describe("Norfleet One bridge", () => {
  it("bills start unclassified, and only business and mixed bills are shared, each record matching the contract", async () => {
    const other = await createUser();
    await withUser(other.id, (tx) => createBill(tx, other.id, billInput({ name: "Someone else's (fictional)", business_use: "business" }), "2026-11-01"));

    const { status, body } = await call("obligations", "?from=2026-11-01&to=2026-12-31");
    expect(status).toBe(200);
    expect(body).toMatchObject({ contract: "billy.obligations", version: "1.0.0", provider: { app: "billy" }, page: { next_cursor: null } });
    const names = new Set(body.data.map((r: { name: string }) => r.name));
    expect([...names].sort()).toEqual(["Adobe (fictional)", "Phone (fictional)"]);
    for (const r of body.data) expect(schemaProblem(r)).toBeNull();
    const phone = body.data.find((r: { name: string }) => r.name.startsWith("Phone"));
    expect(phone).toMatchObject({ business_use: "mixed", business_share_bp: 5000, category: "phone_internet", status: "open", paid_on: null });
    expect(body.data.find((r: { name: string }) => r.name.startsWith("Adobe"))).toMatchObject({ business_share_bp: 10000, autopay: true });
    const text = JSON.stringify(body);
    for (const leak of ["secret note", "pay.example.test", "Gym", "Hydro", "Someone else"]) expect(text).not.toContain(leak);
    expect(body.completeness).toEqual({ status: "partial", notes: ["1 bill in Billy isn't sorted yet"] });
  });

  it("a paid occurrence carries its payment, and sorting a bill later shares it", async () => {
    const [adobe] = await as((tx) => tx<{ id: string }[]>`select id from bills where name like 'Adobe%'`);
    const occ = (await as((tx) => listOccurrencesForBill(tx, user.id, adobe.id))).find((o) => o.due_date === "2026-11-03")!;
    await as((tx) => recordPayment(tx, user.id, { occurrenceId: occ.id, amountMinor: 8049, paidOn: "2026-11-02", note: null }));
    const { body } = await call("obligations", "?from=2026-11-01&to=2026-11-30");
    expect(body.data.find((r: { id: string }) => r.id === "occ_" + occ.id.replace(/-/g, ""))).toMatchObject({ status: "paid", paid_on: "2026-11-02", payment_amount_minor: 8049 });

    const [hydro] = await as((tx) => tx<{ id: string }[]>`select id from bills where name like 'Hydro%'`);
    await as((tx) => updateBill(tx, user.id, hydro.id, billInput({ name: "Hydro (fictional)", amount_minor: 11248, due_date: "2026-11-15", business_use: "business" }), "2026-11-01"));
    const after = await call("obligations", "?from=2026-11-01&to=2026-11-30");
    expect(after.body.data.some((r: { name: string }) => r.name.startsWith("Hydro"))).toBe(true);
    expect(after.body.completeness.status).toBe("complete");
  });

  it("pages by cursor without repeats", async () => {
    const first = await call("obligations", "?from=2026-11-01&to=2027-06-30&limit=3");
    expect(first.body.data).toHaveLength(3);
    const cursor = first.body.page.next_cursor;
    expect(cursor).toMatch(/^occ_[a-f0-9]{32}$/);
    const second = await call("obligations", `?from=2026-11-01&to=2027-06-30&limit=3&cursor=${cursor}`);
    const ids = [...first.body.data, ...second.body.data].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("health gives versions, scope and counts only", async () => {
    const { status, body } = await call("health");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", supported_versions: ["1"], scopes: ["obligations:read"], shared_bills: 2, unclassified_bills: 1 });
    expect(JSON.stringify(body)).not.toContain("fictional");
  });

  it("refuses bad signatures, replays, old requests and revoked keys with a plain 401", async () => {
    const url = `${BASE}/obligations`;
    const h = await signConnectRequest({ method: "GET", url, key, nowSec: Math.floor(NOW / 1000) });
    const once = await handleConnect(new Request(url, { headers: h }), "obligations", connectDb, NOW);
    expect(once.status).toBe(200);
    const replay = await handleConnect(new Request(url, { headers: h }), "obligations", connectDb, NOW);
    expect(replay.status).toBe(401);
    expect((await call("obligations", "", { now: NOW, headers: { "x-norfleet-signature": "x".repeat(43) } })).status).toBe(401);
    const old = await signConnectRequest({ method: "GET", url, key, nowSec: Math.floor(NOW / 1000) - 600 });
    expect((await handleConnect(new Request(url, { headers: old }), "obligations", connectDb, NOW)).status).toBe(401);
    expect((await call("obligations", "", { key: parseConnectKey("nck_zzzz9999zzzz_" + "B".repeat(43))! })).status).toBe(401);

    await as((tx) => tx`select public.connect_revoke_key(${key.keyId})`);
    expect((await call("health")).status).toBe(401);
    expect((await sql()`select count(*)::int as n from vault.secrets`)[0].n).toBe(0);
  });

  it("is read-only, owner-scoped and closed to other roles", async () => {
    expect((await handleConnect(new Request(`${BASE}/health`, { method: "POST" }), "health", connectDb, NOW)).status).toBe(405);
    expect((await call("obligations", "?from=2026-12-01&to=2026-11-01")).status).toBe(400);
    // Another user can't see or revoke this key.
    const other = await createUser();
    const st = await withUser(other.id, (tx) => tx<{ j: { keys: unknown[] } }[]>`select public.connect_status() as j`);
    expect(st[0].j.keys).toEqual([]);
    await expect(withUser(other.id, (tx) => tx`select public.connect_revoke_key(${key.keyId})`)).rejects.toThrow(/key not found/);
    // Signed-in users can't call the API functions or read the tables directly.
    await expect(withUser(other.id, (tx) => tx`select connect.api_key(${key.keyId})`)).rejects.toThrow(/permission denied/);
    await expect(withUser(other.id, (tx) => tx`select * from connect.keys`)).rejects.toThrow(/permission denied/);
    // At most two active keys.
    await as((tx) => tx`select public.connect_create_key()`);
    await expect(as((tx) => tx`select public.connect_create_key()`)).rejects.toThrow(/two keys/);
  });

  it("a mixed bill needs its share, and the others never carry one", async () => {
    await expect(as((tx) => tx`update bills set business_use = 'mixed', business_share_bp = null where name like 'Gym%'`)).rejects.toThrow(/business_share/);
    await expect(as((tx) => tx`update bills set business_share_bp = 5000 where name like 'Adobe%'`)).rejects.toThrow(/business_share/);
  });
});
