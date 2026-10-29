import "server-only";
import { withUser, type Tx } from "@/lib/db/client";
import { requireUser, type Profile, type SessionUser } from "@/lib/auth/session";
import { materializeOccurrences } from "@/lib/data/occurrences";
import { todayIn, type LocalDate } from "@/lib/domain/dates";

export interface UserContext {
  user: SessionUser;
  profile: Profile;
  today: LocalDate;
}

/** Page helper: signed-in user, their profile, and today's date in their time zone. */
export async function pageContext(opts: { allowUnonboarded?: boolean } = {}): Promise<UserContext> {
  const { user, profile } = await requireUser(opts);
  return { user, profile, today: todayIn(profile.time_zone) };
}

/** Run queries as the user after making sure upcoming occurrences exist. */
export async function withFreshData<T>(ctx: UserContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUser(ctx.user.id, async (tx) => {
    await materializeOccurrences(tx, ctx.user.id, ctx.today);
    return fn(tx);
  });
}
