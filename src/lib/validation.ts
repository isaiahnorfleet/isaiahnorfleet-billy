import { z } from "zod";
import { CATEGORIES } from "@/lib/domain/categories";
import { isLocalDate } from "@/lib/domain/dates";
import { parseAmountToMinor } from "@/lib/domain/money";
import { RECURRENCES } from "@/lib/domain/recurrence";
import { normalizePaymentUrl } from "@/lib/domain/url";

/** Strip control characters and trim. React escapes output, but we also keep stored text clean. */
export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

const text = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max));
const optionalText = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? cleanText(v) : ""))
    .pipe(z.string().max(max))
    .transform((v) => (v === "" ? null : v));

export const localDate = z.string().refine(isLocalDate, "Enter a valid date");
export const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");
const offsets = z.array(z.coerce.number().int().min(0).max(30)).max(6);

export const billInput = z
  .object({
    name: text(80).pipe(z.string().min(1, "Give the bill a name")),
    amount: z.string(),
    currency: currency.default("CAD"),
    category: z.enum(CATEGORIES).default("other"),
    recurrence: z.enum(RECURRENCES),
    due_date: localDate,
    autopay: z.boolean().default(false),
    payment_url: z.string().optional(),
    notes: optionalText(1000),
    reminders_enabled: z.boolean().default(true),
    reminder_offsets: offsets.nullable().default(null),
  })
  .transform((v, ctx) => {
    const amount_minor = parseAmountToMinor(v.amount, v.currency);
    if (amount_minor === null) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount like 79.99" });
      return z.NEVER;
    }
    let payment_url: string | null = null;
    if (v.payment_url && v.payment_url.trim() !== "") {
      payment_url = normalizePaymentUrl(v.payment_url);
      if (!payment_url) {
        ctx.addIssue({ code: "custom", path: ["payment_url"], message: "Use a web address starting with https://" });
        return z.NEVER;
      }
    }
    return { ...v, amount_minor, payment_url };
  });
export type BillInput = z.output<typeof billInput>;

export const paymentInput = z.object({
  occurrence_id: z.string().uuid(),
  amount: z.string(),
  paid_on: localDate,
  note: optionalText(500),
});

export const occurrenceEditInput = z.object({
  occurrence_id: z.string().uuid(),
  amount: z.string(),
  due_date: localDate,
  note: optionalText(500),
});

export const cantPayInput = z.object({
  occurrence_id: z.string().uuid(),
  planned_payment_date: localDate.nullable(),
  note: optionalText(500),
  remind: z.boolean().default(true),
});

export const profileInput = z.object({
  display_name: text(60),
  currency,
  time_zone: z.string().min(1).max(64),
  tone: z.enum(["gentle", "straight", "extra"]),
});

export const preferencesInput = z
  .object({
    push_enabled: z.boolean(),
    email_enabled: z.boolean(),
    email_address: optionalText(254).refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email"),
    default_offsets: offsets,
    reminder_hour: z.coerce.number().int().min(0).max(23),
    overdue_followups: z.boolean(),
    overdue_followup_days: z.coerce.number().int().min(0).max(14),
    quiet_hours_enabled: z.boolean(),
    quiet_start: z.string().regex(/^\d{2}:\d{2}$/),
    quiet_end: z.string().regex(/^\d{2}:\d{2}$/),
    max_per_day: z.coerce.number().int().min(1).max(20),
    lock_screen_details: z.boolean(),
  })
  .refine((v) => !v.email_enabled || v.email_address, { path: ["email_address"], message: "Add an email address to get email reminders" });

export const pushSubscriptionInput = z.object({
  endpoint: z.string().url().startsWith("https://").max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  device_label: optionalText(80),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
