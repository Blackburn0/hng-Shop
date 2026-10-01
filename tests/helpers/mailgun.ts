import { http, HttpResponse } from "msw";

// Fake Mailgun (third-party). Captures every message instead of sending it.
const BASE = process.env.MAILGUN_API_URL ?? "https://api.mailgun.net";

export type SentMail = { to: string; from: string; subject: string; html: string; text: string; tags: string[] };

export const mailgun = {
  sent: [] as SentMail[],
  /** number of upcoming sends that should fail with a 500 */
  failNext: 0,
  /** reply 200 but without a message id (malformed success) */
  omitIdNext: 0,
  reset() {
    this.sent = [];
    this.failNext = 0;
    this.omitIdNext = 0;
  },
  to(email: string) {
    return this.sent.filter((m) => m.to === email);
  },
};

let seq = 0;

export const mailgunHandlers = [
  http.post(`${BASE}/v3/:domain/messages`, async ({ request, params }) => {
    if (params.domain !== process.env.MAILGUN_DOMAIN) {
      return HttpResponse.json({ message: "Domain not found" }, { status: 404 });
    }
    if (!request.headers.get("authorization")?.startsWith("Basic ")) {
      return HttpResponse.json({ message: "Forbidden" }, { status: 401 });
    }
    if (mailgun.failNext > 0) {
      mailgun.failNext--;
      return HttpResponse.json(
        { message: `Internal error while sending to ${process.env.MAILGUN_DOMAIN} for ada@example.com` },
        { status: 500 },
      );
    }
    if (mailgun.omitIdNext > 0) {
      mailgun.omitIdNext--;
      return HttpResponse.json({ message: "Queued. Thank you." });
    }
    const form = await request.formData();
    mailgun.sent.push({
      to: String(form.get("to")),
      from: String(form.get("from")),
      subject: String(form.get("subject")),
      html: String(form.get("html")),
      text: String(form.get("text")),
      tags: form.getAll("o:tag").map(String),
    });
    return HttpResponse.json({ id: `<test-${++seq}@mailgun.test>`, message: "Queued. Thank you." });
  }),
];
