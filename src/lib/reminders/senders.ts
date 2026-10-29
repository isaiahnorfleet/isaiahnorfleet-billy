import webpush from "web-push";
import { Resend } from "resend";
import { env } from "@/lib/env";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * accepted: the push service (Apple/Google/Mozilla) accepted the message. Not proof of display.
 * expired: the subscription is gone (HTTP 404/410) and must be deactivated.
 * failed: anything else; may be retried.
 */
export interface PushResult {
  status: "accepted" | "expired" | "failed";
  httpStatus: number | null;
  error: string | null;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface EmailResult {
  status: "accepted" | "failed";
  providerId: string | null;
  httpStatus: number | null;
  error: string | null;
}

export interface Senders {
  push(target: PushTarget, payload: PushPayload): Promise<PushResult>;
  email(message: EmailMessage): Promise<EmailResult>;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function realSenders(): Senders {
  const e = env();
  return {
    async push(target, payload) {
      if (!e.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) {
        return { status: "failed", httpStatus: null, error: "Push is not configured on the server" };
      }
      try {
        const res = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            TTL: 60 * 60 * 12,
            urgency: "normal",
            topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
            vapidDetails: { subject: e.VAPID_SUBJECT, publicKey: e.NEXT_PUBLIC_VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY },
            timeout: 10_000,
          },
        );
        return { status: "accepted", httpStatus: res.statusCode, error: null };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? null;
        const body = (err as { body?: string }).body ?? (err as Error).message ?? "Unknown error";
        if (status === 404 || status === 410) return { status: "expired", httpStatus: status, error: "Subscription expired or was revoked" };
        return { status: "failed", httpStatus: status, error: truncate(String(body)) };
      }
    },
    async email(message) {
      if (!e.RESEND_API_KEY || !e.EMAIL_FROM) {
        return { status: "failed", providerId: null, httpStatus: null, error: "Email is not configured on the server" };
      }
      try {
        const resend = new Resend(e.RESEND_API_KEY);
        const { data, error } = await resend.emails.send(
          { from: e.EMAIL_FROM, to: message.to, subject: message.subject, text: message.text, html: message.html },
          { idempotencyKey: message.idempotencyKey },
        );
        if (error) return { status: "failed", providerId: null, httpStatus: (error as { statusCode?: number }).statusCode ?? null, error: truncate(error.message) };
        return { status: "accepted", providerId: data?.id ?? null, httpStatus: 200, error: null };
      } catch (err) {
        return { status: "failed", providerId: null, httpStatus: null, error: truncate((err as Error).message ?? "Unknown error") };
      }
    },
  };
}

/** Records messages in memory. Endpoints/addresses containing "fail" or "gone" simulate failures. */
export function fakeSenders(): Senders & { sent: { channel: "push" | "email"; to: string; title: string; body: string }[] } {
  const sent: { channel: "push" | "email"; to: string; title: string; body: string }[] = [];
  return {
    sent,
    async push(target, payload) {
      if (target.endpoint.includes("gone")) return { status: "expired", httpStatus: 410, error: "Subscription expired or was revoked" };
      if (target.endpoint.includes("fail")) return { status: "failed", httpStatus: 503, error: "Push service unavailable" };
      sent.push({ channel: "push", to: target.endpoint, title: payload.title, body: payload.body });
      return { status: "accepted", httpStatus: 201, error: null };
    },
    async email(message) {
      if (message.to.includes("fail")) return { status: "failed", providerId: null, httpStatus: 500, error: "Email provider error" };
      sent.push({ channel: "email", to: message.to, title: message.subject, body: message.text });
      return { status: "accepted", providerId: `fake_${message.idempotencyKey.slice(0, 12)}`, httpStatus: 200, error: null };
    },
  };
}

export function defaultSenders(): Senders {
  return env().NOTIFY_PROVIDER === "fake" ? fakeSenders() : realSenders();
}
