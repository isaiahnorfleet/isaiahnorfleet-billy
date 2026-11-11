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
    autopay_account: optionalText(60),
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
    // A label is enough to recognize the account; refuse anything that looks like a full account or card number.
    if (v.autopay_account && /\d{5,}/.test(v.autopay_account.replace(/[\s-]/g, ""))) {
      ctx.addIssue({ code: "custom", path: ["autopay_account"], message: "Use a nickname and at most the last 4 digits, not the full number" });
      return z.NEVER;
    }
    return { ...v, amount_minor, payment_url, autopay_account: v.autopay ? v.autopay_account : null };
  });
export type BillInput = z.output<typeof billInput>;

/** Shared money parsing for budget forms. `allowZero` lets a category limit be $0. */
function withAmount<T extends { amount: string; currency: string }>(v: T, ctx: z.RefinementCtx, field = "amount", allowZero = false) {
  const minor = parseAmountToMinor(v.amount, v.currency);
  if (minor === null || (!allowZero && minor === 0)) {
    ctx.addIssue({ code: "custom", path: [field], message: allowZero ? "Enter an amount like 400" : "Enter an amount more than zero, like 24.50" });
    return null;
  }
  return minor;
}

export const incomeInput = z
  .object({
    name: text(80).pipe(z.string().min(1, "Give it a name, like Paycheque")),
    amount: z.string(),
    currency: currency.default("CAD"),
    recurrence: z.enum(RECURRENCES),
    anchor_date: localDate,
  })
  .transform((v, ctx) => {
    const amount_minor = withAmount(v, ctx);
    if (amount_minor === null) return z.NEVER;
    return { name: v.name, currency: v.currency, recurrence: v.recurrence, anchor_date: v.anchor_date, amount_minor };
  });
export type IncomeInput = z.output<typeof incomeInput>;

export const categoryInput = z
  .object({
    name: text(40).pipe(z.string().min(1, "Give the category a name")),
    limit: z.string().optional(),
    currency: currency.default("CAD"),
  })
  .transform((v, ctx) => {
    if (!v.limit || v.limit.trim() === "") return { name: v.name, limit_minor: null as number | null };
    const limit_minor = withAmount({ amount: v.limit, currency: v.currency }, ctx, "limit", true);
    if (limit_minor === null) return z.NEVER;
    return { name: v.name, limit_minor: limit_minor as number | null };
  });
export type CategoryInput = z.output<typeof categoryInput>;

export const expenseInput = z
  .object({
    amount: z.string(),
    currency: currency.default("CAD"),
    category_id: z.string().uuid().nullable().default(null),
    spent_on: localDate,
    note: optionalText(200),
  })
  .transform((v, ctx) => {
    const amount_minor = withAmount(v, ctx);
    if (amount_minor === null) return z.NEVER;
    return { currency: v.currency, category_id: v.category_id, spent_on: v.spent_on, note: v.note, amount_minor };
  });
export type ExpenseInput = z.output<typeof expenseInput>;

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
