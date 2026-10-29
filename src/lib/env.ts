import "server-only";
import { z } from "zod";

/**
 * Server environment. Secrets are read only on the server and never exposed to the browser.
 * Configure them in .env.local for development and in Vercel project settings for production.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_MODE: z.enum(["supabase", "dev"]).default("supabase"),
  DEV_AUTH_SECRET: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  /** "fake" replaces real push/email providers with in-process fakes. Test environments only. */
  NOTIFY_PROVIDER: z.enum(["real", "fake"]).default("real"),
  VERCEL_ENV: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  const isProd = parsed.VERCEL_ENV === "production";
  if (isProd && parsed.AUTH_MODE === "dev") throw new Error("AUTH_MODE=dev is not allowed in production");
  if (isProd && parsed.NOTIFY_PROVIDER === "fake") throw new Error("NOTIFY_PROVIDER=fake is not allowed in production");
  if (parsed.AUTH_MODE === "dev" && (!parsed.DEV_AUTH_SECRET || parsed.DEV_AUTH_SECRET.length < 32)) {
    throw new Error("DEV_AUTH_SECRET (32+ chars) is required when AUTH_MODE=dev");
  }
  cached = parsed;
  return parsed;
}

export function pushConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.VAPID_SUBJECT) || e.NOTIFY_PROVIDER === "fake";
}

export function emailConfigured(): boolean {
  const e = env();
  return Boolean(e.RESEND_API_KEY && e.EMAIL_FROM) || e.NOTIFY_PROVIDER === "fake";
}
