import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

// Fallback sender: Gmail SMTP with an App Password. Used only when Mailgun
// refuses a message (e.g. the sandbox's "authorized recipients only" 403), so
// any customer gets their confirmation without a verified domain.

type Message = { to: string; subject: string; html: string; text: string };

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const config = z.object({
  GMAIL_USER: z.preprocess(blankToUndefined, z.email().optional()),
  // Google shows App Passwords as "abcd efgh ijkl mnop"; spaces aren't part of it.
  GMAIL_APP_PASSWORD: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\s+/g, "") : v),
    z.preprocess(blankToUndefined, z.string().min(16).optional()),
  ),
  EMAIL_FROM_NAME: z.preprocess(blankToUndefined, z.string().max(80).default("Coffee Shop")),
});

export type GmailConfig = { user: string; password: string; fromName: string };

/** Gmail credentials from the environment, or null when the fallback isn't set up. Read per call. */
export function gmailConfig(): GmailConfig | null {
  const parsed = config.safeParse(process.env);
  if (!parsed.success || !parsed.data.GMAIL_USER || !parsed.data.GMAIL_APP_PASSWORD) return null;
  return { user: parsed.data.GMAIL_USER, password: parsed.data.GMAIL_APP_PASSWORD, fromName: parsed.data.EMAIL_FROM_NAME };
}

let cached: { key: string; transport: Transporter } | undefined;

function transport(cfg: GmailConfig): Transporter {
  const key = `${cfg.user}:${cfg.password}`;
  if (cached?.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        service: "gmail",
        auth: { user: cfg.user, pass: cfg.password },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    };
  }
  return cached.transport;
}

/** Send through Gmail. Resolves to the SMTP message id; throws on failure. */
export async function sendViaGmail(cfg: GmailConfig, { to, subject, html, text }: Message): Promise<string> {
  const info = await transport(cfg).sendMail({
    from: { name: cfg.fromName, address: cfg.user },
    to,
    subject,
    html,
    text,
  });
  if (!info.messageId) throw new Error("Gmail did not return a message id");
  return info.messageId;
}
