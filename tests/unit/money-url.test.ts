import { describe, expect, it } from "vitest";
import { formatMoney, formatTotals, minorToInput, parseAmountToMinor } from "@/lib/domain/money";
import { normalizePaymentUrl } from "@/lib/domain/url";

describe("money", () => {
  it("parses user input to exact minor units", () => {
    expect(parseAmountToMinor("1,450.00")).toBe(145000);
    expect(parseAmountToMinor("$79.99")).toBe(7999);
    expect(parseAmountToMinor("112.5")).toBe(11250);
    expect(parseAmountToMinor("0.1")).toBe(10);
    expect(parseAmountToMinor("19.999")).toBeNull();
    expect(parseAmountToMinor("-5")).toBeNull();
    expect(parseAmountToMinor("abc")).toBeNull();
    expect(parseAmountToMinor("")).toBeNull();
  });

  it("avoids float rounding errors", () => {
    // 0.1 + 0.2 style errors must not appear: 1.15 is 115 cents, not 114.99999.
    expect(parseAmountToMinor("1.15")).toBe(115);
    expect(parseAmountToMinor("4.35")).toBe(435);
  });

  it("formats CAD for display and inputs", () => {
    expect(formatMoney(152999, "CAD")).toBe("$1,529.99");
    expect(minorToInput(145000)).toBe("1450.00");
    expect(minorToInput(5)).toBe("0.05");
  });

  it("keeps different currencies separate instead of adding them", () => {
    expect(formatTotals({ CAD: 1000, USD: 500 }, "CAD")).toBe("$10.00 + US$5.00");
    expect(formatTotals({}, "CAD")).toBe("$0.00");
  });
});

describe("payment URLs", () => {
  it("accepts http(s) and adds https when missing", () => {
    expect(normalizePaymentUrl("hydroquebec.com/pay")).toBe("https://hydroquebec.com/pay");
    expect(normalizePaymentUrl("https://www.bell.ca/")).toBe("https://www.bell.ca/");
  });

  it("rejects unsafe protocols and embedded credentials", () => {
    expect(normalizePaymentUrl("javascript:alert(1)")).toBeNull();
    expect(normalizePaymentUrl("data:text/html,hi")).toBeNull();
    expect(normalizePaymentUrl("ftp://example.com")).toBeNull();
    expect(normalizePaymentUrl("https://user:pass@bank.example.com")).toBeNull();
    expect(normalizePaymentUrl("https://localhost")).toBeNull();
  });
});
