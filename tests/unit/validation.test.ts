import { describe, expect, it } from "vitest";
import { billInput } from "@/lib/validation";

const base = { name: "Hydro", amount: "80", currency: "CAD", category: "utilities", recurrence: "monthly", due_date: "2026-11-15" };

describe("autopay account", () => {
  it("keeps a nickname with the last 4 digits", () => {
    const r = billInput.safeParse({ ...base, autopay: true, autopay_account: "  TD Chequing ••1234 " });
    expect(r.success && r.data.autopay_account).toBe("TD Chequing ••1234");
  });

  it("refuses something that looks like a full account or card number", () => {
    for (const v of ["TD 1234567", "4520 1234 5678 9012", "00123-4567890"]) {
      const r = billInput.safeParse({ ...base, autopay: true, autopay_account: v });
      expect(r.success, v).toBe(false);
    }
  });

  it("is cleared when the bill is not on autopay", () => {
    const r = billInput.safeParse({ ...base, autopay: false, autopay_account: "TD Chequing" });
    expect(r.success && r.data.autopay_account).toBeNull();
  });
});

describe("For the business? on a bill", () => {
  const base = { name: "Phone", amount: "100.00", recurrence: "monthly", due_date: "2026-12-03" };
  it("defaults to not sorted, and keeps no share unless mixed", () => {
    const r = billInput.parse(base);
    expect(r).toMatchObject({ business_use: "unclassified", business_share_bp: null });
    expect(billInput.parse({ ...base, business_use: "business", business_share: "40" })).toMatchObject({ business_use: "business", business_share_bp: null });
  });
  it("a mixed bill needs a whole percent from 1 to 99", () => {
    expect(billInput.parse({ ...base, business_use: "mixed", business_share: "50 %" })).toMatchObject({ business_share_bp: 5000 });
    for (const bad of ["", "0", "100", "12.5", "abc"]) expect(billInput.safeParse({ ...base, business_use: "mixed", business_share: bad }).success).toBe(false);
  });
});
