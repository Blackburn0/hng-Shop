import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";

describe("formatMoney", () => {
  it.each([
    [350000, "₦3,500.00"],
    [0, "₦0.00"],
    [1, "₦0.01"],
    [123456789, "₦1,234,567.89"],
  ])("formats %i kobo as %s", (kobo, expected) => {
    expect(formatMoney(kobo)).toBe(expected);
  });

  it("formats other currencies when asked", () => {
    expect(formatMoney(1990, "USD")).toBe("$19.90");
  });
});
