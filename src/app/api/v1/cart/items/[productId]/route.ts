import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getCart, removeItem, setItemQuantity, setQuantityBody } from "@/lib/cart";
import { problems, readJson } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ productId: string }> };
const params = z.object({ productId: z.uuid("must be a UUID") });

/** Set an item's quantity (idempotent). Responds with the whole updated cart. */
export async function PUT(req: Request, ctx: Ctx) {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const p = params.safeParse(await ctx.params);
  if (!p.success) return problems.badRequest(pathname, p.error);

  const json = await readJson(req);
  if (!json.ok) return problems.malformedJson(pathname);
  const body = setQuantityBody.safeParse(json.value);
  if (!body.success) return problems.validation(pathname, body.error);

  try {
    const ok = await setItemQuantity(auth.db, auth.user.id, p.data.productId, body.data.quantity);
    if (!ok) return problems.notFound(pathname, "That product doesn't exist or is no longer available.");
    return Response.json(await getCart(auth.db, auth.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("PUT /api/v1/cart/items/[productId] failed", err);
    return problems.internal(pathname);
  }
}

/** Remove an item. Idempotent: removing an item that isn't in the cart is still 204. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const p = params.safeParse(await ctx.params);
  if (!p.success) return problems.badRequest(pathname, p.error);

  try {
    await removeItem(auth.db, auth.user.id, p.data.productId);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("DELETE /api/v1/cart/items/[productId] failed", err);
    return problems.internal(pathname);
  }
}
