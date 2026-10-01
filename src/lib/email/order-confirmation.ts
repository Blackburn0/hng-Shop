import { formatMoney } from "@/lib/money";
import type { Order } from "@/lib/orders";

// Order confirmation email. Table layout with inline styles, because many
// email clients ignore <style> blocks, flexbox and web fonts.

const ESPRESSO = "#351C0F";
const PILL = "#E8E8E8";
const dateFmt = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function orderNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderOrderConfirmation(order: Order, siteUrl: string): RenderedEmail {
  const no = orderNumber(order.id);
  const firstName = order.delivery.name.trim().split(/\s+/)[0]!; // name is validated non-empty
  const orderUrl = new URL(`/orders/${order.id}`, siteUrl).toString();
  const placed = dateFmt.format(new Date(order.createdAt));
  const money = (minor: number) => formatMoney(minor, order.currency);
  const isCash = order.paymentMethod === "cash";
  const statusLine = isCash
    ? "Your order is confirmed. Please have the exact amount ready when it arrives."
    : "Your payment was received and your order is being prepared.";
  const paymentLabel = isCash ? "Cash on delivery" : "Card via Paystack";

  const subject = `Your Coffee Shop order #${no}`;
  const e = escapeHtml;

  const rows = order.items
    .map(
      (i) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #ddd;font-size:16px;">
            <strong>${e(i.productName)}</strong>
            <span style="color:#555;"> &nbsp;${i.quantity} &times; ${e(money(i.unitPriceMinor))}</span>
          </td>
          <td align="right" style="padding:12px 0;border-bottom:1px solid #ddd;font-size:16px;white-space:nowrap;">${e(money(i.lineTotalMinor))}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ee;font-family:Avenir,'Nunito Sans',Helvetica,Arial,sans-serif;color:#000;">
  <span style="display:none;max-height:0;overflow:hidden;">Order #${no} · ${e(money(order.totalMinor))} · ${e(paymentLabel)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ee;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:24px;overflow:hidden;">
        <tr><td style="background:${ESPRESSO};padding:24px 32px;color:#fff;font-family:'Brush Script MT','Segoe Script',cursive;font-size:34px;">Coffee Shop</td></tr>
        <tr><td style="padding:32px 32px 8px;">
          <h1 style="margin:0;font-family:Futura,'Trebuchet MS',Arial,sans-serif;font-size:30px;">Thank you, ${e(firstName)}!</h1>
          <p style="margin:12px 0 0;font-size:16px;line-height:1.5;">${statusLine}</p>
          <p style="margin:16px 0 0;font-size:14px;color:#555;">Order <strong style="color:#000;">#${no}</strong> &middot; ${e(placed)}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td colspan="2" style="border-bottom:1.5px solid #000;padding-bottom:6px;font-size:20px;font-weight:800;">Order summary</td></tr>
            ${rows}
            <tr>
              <td align="right" style="padding:16px 16px 0 0;font-size:20px;font-weight:800;">Total:</td>
              <td align="right" style="padding:16px 0 0;font-size:20px;white-space:nowrap;">${e(money(order.totalMinor))}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ESPRESSO};border-radius:20px;color:#fff;">
            <tr><td style="padding:20px 24px;font-size:15px;line-height:1.6;">
              <strong style="font-size:17px;">Delivery</strong><br>
              ${e(order.delivery.name)}<br>${e(order.delivery.phone)}<br>${e(order.delivery.address).replace(/\n/g, "<br>")}
              <br><br><strong style="font-size:17px;">Payment</strong><br>${e(paymentLabel)}
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:28px 32px 8px;">
          <a href="${e(orderUrl)}" style="display:inline-block;padding:12px 32px;border:4px solid ${ESPRESSO};border-radius:999px;color:${ESPRESSO};text-decoration:none;font-size:18px;">View your order</a>
        </td></tr>
        <tr><td align="center" style="padding:24px 32px 28px;font-size:12px;color:#777;">
          <span style="display:inline-block;background:${PILL};border-radius:999px;padding:4px 12px;color:${ESPRESSO};">one Stop | one Heart | one Cup</span>
          <br><br>You're getting this because you placed an order at Coffee Shop.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Thank you, ${firstName}!`,
    "",
    statusLine,
    "",
    `Order #${no} · ${placed}`,
    "",
    "Order summary",
    ...order.items.map((i) => `- ${i.productName}  ${i.quantity} x ${money(i.unitPriceMinor)}  = ${money(i.lineTotalMinor)}`),
    `Total: ${money(order.totalMinor)}`,
    "",
    "Delivery",
    order.delivery.name,
    order.delivery.phone,
    order.delivery.address,
    "",
    `Payment: ${paymentLabel}`,
    "",
    `View your order: ${orderUrl}`,
    "",
    "Coffee Shop · one Stop | one Heart | one Cup",
  ].join("\n");

  return { subject, html, text };
}
