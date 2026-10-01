import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getCart, removeItem, setItemQuantity, setQuantityBody } from "@/lib/cart";
import { problems, readJson } from "@/lib/http/problem";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ productId: string }> };
const params = z.object({ productId: z.uuid("must be a UUID") });

/** Set an item's quantity (idempotent). Responds with the whole updated cart. */
export const PUT = route({ rateLimit: { bucket: "cart", ...LIMITS.user } }, async (req: Request, ctx: Ctx) => {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const p = params.safeParse(await ctx.params);
  if (!p.success) return problems.badRequest(pathname, p.error);

  const json = await readJson(req);
  if (!json.ok) return json.error;
  const body = setQuantityBody.safeParse(json.value);
  if (!body.success) return problems.validation(pathname, body.error);

  try {
    const ok = await setItemQuantity(auth.db, auth.user.id, p.data.productId, body.data.quantity);
    if (!ok) return problems.notFound(pathname, "That product doesn't exist or is no longer available.");
    return Response.json(await getCart(auth.db, auth.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("PUT /api/v1/cart/items/[productId] failed", { err });
    return problems.internal(pathname);
  }
});

/** Remove an item. Idempotent: removing an item that isn't in the cart is still 204. */
export const DELETE = route({ rateLimit: { bucket: "cart", ...LIMITS.user } }, async (req: Request, ctx: Ctx) => {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const p = params.safeParse(await ctx.params);
  if (!p.success) return problems.badRequest(pathname, p.error);

  try {
    await removeItem(auth.db, auth.user.id, p.data.productId);
    return new Response(null, { status: 204 });
  } catch (err) {
    log.error("DELETE /api/v1/cart/items/[productId] failed", { err });
    return problems.internal(pathname);
  }
});
