"use server";

import { revalidatePath } from "next/cache";
import { requireUserForAction } from "@/lib/auth/session";
import { withUser } from "@/lib/db/client";
import { failure, type ActionResult } from "./result";

/** Settings → Norfleet One: make a read-only key (shown once). */
export async function createConnectKeyAction(): Promise<ActionResult<{ key: string; expiresAt: string }>> {
  try {
    const { user } = await requireUserForAction();
    const [r] = await withUser(user.id, (tx) => tx<{ j: { key: string; expires_at: string } }[]>`select public.connect_create_key() as j`);
    revalidatePath("/settings");
    return { ok: true, key: r.j.key, expiresAt: r.j.expires_at };
  } catch (err) {
    const msg = (err as Error).message || "";
    return failure(msg.includes("two keys") ? "Two keys are already active. Revoke the old one first." : "Couldn't make a key. Try again.");
  }
}

export async function revokeConnectKeyAction(keyId: string): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    if (!/^[a-z0-9]{8,16}$/.test(keyId)) return failure("That key wasn't found.");
    await withUser(user.id, (tx) => tx`select public.connect_revoke_key(${keyId})`);
    revalidatePath("/settings");
    return { ok: true };
  } catch {
    return failure("Couldn't revoke the key. Try again.");
  }
}
