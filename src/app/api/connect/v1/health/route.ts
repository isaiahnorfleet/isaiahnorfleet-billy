import { handleConnect } from "@/lib/connect/api";
import { connectDb } from "@/lib/connect/db";

export const dynamic = "force-dynamic";

/** Norfleet Connect v1, read-only, for Norfleet One (signed GET). */
export async function GET(req: Request) {
  try {
    return await handleConnect(req, "health", connectDb);
  } catch {
    return Response.json({ error: { code: "unavailable", message: "Try again later" } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
