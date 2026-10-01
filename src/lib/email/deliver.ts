import { gmailConfig, sendViaGmail } from "@/lib/email/gmail";
import { MailgunError, sendEmail } from "@/lib/email/mailgun";
import { log } from "@/lib/log";

type Message = { to: string; subject: string; html: string; text: string; tag: string };
export type Delivery = { provider: "mailgun" | "gmail"; messageId: string };

/**
 * Send via Mailgun; if Mailgun *refuses* the message (it answered with an HTTP
 * error, so nothing was queued) and Gmail is configured, send via Gmail instead.
 *
 * The usual refusal is the sandbox's 403 "add the address to your authorized
 * recipients", which would otherwise stop customers we can't pre-register from
 * getting their confirmation. Timeouts and network errors (no status) are NOT
 * retried on Gmail: Mailgun may have accepted the message, and a duplicate is
 * worse than the normal failed-and-retry path.
 */
export async function deliver(message: Message): Promise<Delivery> {
  try {
    return { provider: "mailgun", messageId: await sendEmail(message) };
  } catch (err) {
    const gmail = gmailConfig();
    const refused = err instanceof MailgunError && err.status !== undefined;
    if (!refused || !gmail) throw err;

    log.warn("mailgun refused the message; sending via gmail", { status: err.status, reason: err.message });
    try {
      return { provider: "gmail", messageId: await sendViaGmail(gmail, message) };
    } catch (gmailErr) {
      const why = gmailErr instanceof Error ? `${gmailErr.name}: ${gmailErr.message}` : "unknown error";
      throw new Error(`${err.message}; Gmail fallback also failed: ${why}`);
    }
  }
}
