import Mailgun from "mailgun.js";
import { serverEnv } from "@/lib/env";

type Message = { to: string; subject: string; html: string; text: string; tag: string };

let client: ReturnType<Mailgun["client"]> | undefined;

function mg() {
  const env = serverEnv();
  // Node's built-in FormData (mailgun.js accepts either it or the form-data package).
  client ??= new Mailgun(FormData).client({
    username: "api",
    key: env.MAILGUN_API_KEY,
    url: env.MAILGUN_API_URL,
    timeout: 10_000,
  });
  return client;
}

/** Send one email. Resolves to Mailgun's message id; throws on any failure. */
export async function sendEmail({ to, subject, html, text, tag }: Message): Promise<string> {
  const env = serverEnv();
  let res;
  try {
    res = await mg().messages.create(env.MAILGUN_DOMAIN, {
      from: env.MAILGUN_FROM,
      to: [to],
      subject,
      html,
      text,
      "o:tag": [tag],
    });
  } catch (err) {
    // mailgun.js errors carry the HTTP status and Mailgun's reason in `details`
    // (e.g. 403 "add the address to your authorized recipients" on a sandbox).
    const { status, details, message } = err as { status?: number; details?: string; message?: string };
    throw new MailgunError(`Mailgun ${status ?? "error"}: ${redact(details || message || "unknown")}`, status);
  }
  if (!res.id) throw new MailgunError(`Mailgun did not accept the message (status ${res.status})`, res.status);
  return res.id;
}

export class MailgunError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailgunError";
  }
}

/** Strip email addresses and domains so the reason is safe to store and log. */
function redact(text: string): string {
  return text.replace(/[\w.+-]+@[\w.-]+/g, "<email>").replace(/sandbox[0-9a-f]+\.mailgun\.org/g, "<sandbox domain>");
}
