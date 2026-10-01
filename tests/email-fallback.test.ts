import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createOrder } from "@/app/api/v1/orders/route";
import type { Tables } from "@/lib/database.types";
import { gmailConfig } from "@/lib/email/gmail";
import { isNetworkFailure } from "@/lib/email/mailgun";
import { sendOrderConfirmation } from "@/lib/email/send-order-confirmation";
import { admin, cleanup, createTestUser, fillCart, seededProduct, type TestUser } from "./helpers/db";
import { request } from "./helpers/http";
import { externalServices, listenOptions, mailgun } from "./helpers/paystack";

// Gmail fallback for order confirmations (src/lib/email/deliver.ts).
// nodemailer (third-party SMTP client) is replaced with a stand-in, so nothing
// is ever sent; Mailgun is the MSW stand-in used by the rest of the suite.

const gmail = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  transports: [] as Record<string, unknown>[],
  failNext: 0,
}));

vi.mock("nodemailer", () => {
  const createTransport = (options: Record<string, unknown>) => {
    gmail.transports.push(options);
    return {
      sendMail: async (mail: Record<string, unknown>) => {
        if (gmail.failNext > 0) {
          gmail.failNext--;
          throw Object.assign(new Error(`Invalid login: 535 5.7.8 Username and Password not accepted for ${String(mail.to)}`), {
            code: "EAUTH",
          });
        }
        gmail.sent.push(mail);
        return { messageId: `<gmail-${gmail.sent.length}@smtp.gmail.test>` };
      },
    };
  };
  return { default: { createTransport }, createTransport };
});

const GMAIL_USER = "coffee.shop.orders@gmail.com";
// A throwaway 16-letter value generated per run, shaped like a Google App
// Password. Generated rather than written out so secret scanners have nothing
// to flag; it is never a real credential.
const FAKE_APP_PASSWORD = Array.from(randomBytes(16), (b) => String.fromCharCode(97 + (b % 26))).join("");
const AS_GOOGLE_SHOWS_IT = FAKE_APP_PASSWORD.match(/.{4}/g)!.join(" "); // four groups of four letters
const delivery = { name: "Ada Lovelace", phone: "08012345678", address: "12 Marina Road, Lagos" };

let user: TestUser;
let americano: Tables<"products">;

async function cashOrder(): Promise<string> {
  await fillCart(user, [{ productId: americano.id, quantity: 1 }]);
  const res = await createOrder(
    request("/api/v1/orders", { method: "POST", token: user.accessToken, body: { paymentMethod: "cash", delivery } }),
  );
  expect(res.status).toBe(201); // an email problem never fails the order
  return ((await res.json()) as { order: { id: string } }).order.id;
}

async function logRow(orderId: string) {
  const { data } = await admin().from("email_log").select("status, provider_message_id, error").eq("order_id", orderId).single();
  return data!;
}

const quiet = () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};

beforeAll(async () => {
  externalServices.listen(listenOptions);
  [user, americano] = await Promise.all([createTestUser(), seededProduct("americano")]);
});
beforeEach(async () => {
  mailgun.reset();
  gmail.sent = [];
  gmail.transports = [];
  gmail.failNext = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("GMAIL_USER", GMAIL_USER);
  vi.stubEnv("GMAIL_APP_PASSWORD", AS_GOOGLE_SHOWS_IT); // with the spaces Google displays
  await admin().from("orders").delete().eq("user_id", user.id);
});
afterAll(async () => {
  externalServices.close();
  vi.unstubAllEnvs();
  await cleanup();
});

describe("gmailConfig()", () => {
  it("reads the credentials, strips the spaces Google shows, and defaults the sender name", () => {
    expect(gmailConfig()).toEqual({ user: GMAIL_USER, password: FAKE_APP_PASSWORD, fromName: "Coffee Shop" });
  });

  it("uses EMAIL_FROM_NAME when set", () => {
    vi.stubEnv("EMAIL_FROM_NAME", "Coffee Shop Lagos");
    expect(gmailConfig()?.fromName).toBe("Coffee Shop Lagos");
  });

  it.each([
    ["no user", { GMAIL_USER: "" }],
    ["no password", { GMAIL_APP_PASSWORD: "" }],
    ["a malformed user", { GMAIL_USER: "not-an-email" }],
    ["a too-short password", { GMAIL_APP_PASSWORD: "short" }],
  ])("is off (null) with %s", (_, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(gmailConfig()).toBeNull();
  });
});

describe("isNetworkFailure()", () => {
  it.each([
    // [message, details, expected] as mailgun.js reports them
    ["ECONNRESET", "read ECONNRESET", true],
    ["ETIMEDOUT", "", true],
    ["ERR_NETWORK", "Network Error", true],
    ["ECONNABORTED", "timeout of 10000ms exceeded", true],
    ["", "Network error", true],
    ["", "socket hang up", true],
    ["", "getaddrinfo ENOTFOUND api.mailgun.net", true],
    // real HTTP refusals: Mailgun's reason in details
    ["Forbidden", "Domain x is not allowed to send: Free accounts are for test purposes only.", false],
    ["", "Domain x is not allowed to send: Free accounts are for test purposes only.", false],
    ["Unauthorized", "Forbidden", false],
    ["Bad Request", "to parameter is not a valid address", false],
  ])("(%j, %j) -> %s", (message, details, expected) => {
    expect(isNetworkFailure(message, details)).toBe(expected);
  });
});

describe("order confirmation delivery", () => {
  it("uses Mailgun when it accepts the message — Gmail is not touched", async () => {
    const id = await cashOrder();

    expect(mailgun.sent).toHaveLength(1);
    expect(gmail.sent).toEqual([]);
    expect(mailgun.sent[0]!.replyTo).toBe(GMAIL_USER); // replies reach a real mailbox
    expect((await logRow(id)).provider_message_id).toMatch(/^mailgun:</);
  });

  it("sets no Reply-To on Mailgun emails when Gmail isn't configured", async () => {
    vi.stubEnv("GMAIL_USER", "");
    await cashOrder();

    expect(mailgun.sent[0]!.replyTo).toBeNull();
  });

  it("falls back to Gmail when the Mailgun sandbox refuses the recipient", async () => {
    quiet();
    mailgun.sandboxRejectNext = 1;

    const id = await cashOrder();

    expect(mailgun.sent).toEqual([]);
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]).toMatchObject({
      from: { name: "Coffee Shop", address: GMAIL_USER },
      to: user.email,
      subject: `Your Coffee Shop order #${id.slice(0, 8).toUpperCase()}`,
      html: expect.stringContaining("₦3,500.00"),
      text: expect.stringContaining("Cash on delivery"),
    });
    expect(gmail.transports.at(-1)).toMatchObject({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: FAKE_APP_PASSWORD },
    });
    expect(await logRow(id)).toEqual({ status: "sent", provider_message_id: "gmail:<gmail-1@smtp.gmail.test>", error: null });
  });

  it("falls back on any Mailgun error response (e.g. 500), since Mailgun queued nothing", async () => {
    quiet();
    mailgun.failNext = 1;

    const id = await cashOrder();

    expect(gmail.sent).toHaveLength(1);
    expect((await logRow(id)).provider_message_id).toMatch(/^gmail:/);
  });

  it("does NOT fall back when the Mailgun connection drops (it may have sent it) — records a failure instead", async () => {
    quiet();
    mailgun.networkErrorNext = 1;

    const id = await cashOrder();

    expect(gmail.sent).toEqual([]);
    expect(await logRow(id)).toMatchObject({ status: "failed", provider_message_id: null });
  });

  it("records a failure (no addresses stored) when Gmail fails too, and a retry can still succeed", async () => {
    quiet();
    mailgun.sandboxRejectNext = 1;
    gmail.failNext = 1;

    const id = await cashOrder();

    const failed = await logRow(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Mailgun 403");
    expect(failed.error).toContain("Gmail fallback also failed");
    expect(failed.error).not.toMatch(/@/);

    // Retry (e.g. after fixing the App Password): Mailgun refuses again, Gmail now works.
    mailgun.sandboxRejectNext = 1;
    expect(await sendOrderConfirmation(admin(), id)).toBe("sent");
    expect(gmail.sent).toHaveLength(1);
    expect((await logRow(id)).provider_message_id).toMatch(/^gmail:/);
  });

  it("without Gmail configured, a sandbox refusal is recorded as failed (previous behaviour)", async () => {
    quiet();
    vi.stubEnv("GMAIL_USER", "");
    mailgun.sandboxRejectNext = 1;

    const id = await cashOrder();

    expect(gmail.sent).toEqual([]);
    expect(await logRow(id)).toMatchObject({ status: "failed", error: expect.stringContaining("Mailgun 403") });
  });

  it("still sends only one email per order when the fallback is used", async () => {
    quiet();
    mailgun.sandboxRejectNext = 1;
    const id = await cashOrder();

    expect(await sendOrderConfirmation(admin(), id)).toBe("already_sent");
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent).toHaveLength(0);
  });
});
