import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("serverEnv", () => {
  it("parses the server variables from .env.local", async () => {
    const { serverEnv } = await import("@/lib/env");
    const env = serverEnv();

    expect(env.PAYSTACK_SECRET_KEY).toMatch(/^sk_/);
    expect(env.MAILGUN_API_URL).toMatch(/^https:\/\//);
  });

  it("names a missing variable without printing any values", async () => {
    vi.stubEnv("MAILGUN_DOMAIN", "");
    const { serverEnv } = await import("@/lib/env");

    expect(() => serverEnv()).toThrow(/MAILGUN_DOMAIN/);
  });

  it("refuses to run in the browser", async () => {
    vi.stubGlobal("window", {});
    const { serverEnv } = await import("@/lib/env");

    expect(() => serverEnv()).toThrow(/must not be called in the browser/);
  });
});
