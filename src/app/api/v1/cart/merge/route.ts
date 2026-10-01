import { getAuth } from "@/lib/auth";
import { getCart, mergeBody, mergeItems } from "@/lib/cart";
import { problems, readJson } from "@/lib/http/problem";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Merge the guest (localStorage) cart into the signed-in user's cart. */
export const POST = route({ rateLimit: { bucket: "cart", ...LIMITS.user } }, async (req: Request) => {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const json = await readJson(req);
  if (!json.ok) return json.error;
  const body = mergeBody.safeParse(json.value);
  if (!body.success) return problems.validation(pathname, body.error);

  try {
    const { skipped } = await mergeItems(auth.db, auth.user.id, body.data.items);
    const cart = await getCart(auth.db, auth.user.id);
    return Response.json({ ...cart, skipped }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("POST /api/v1/cart/merge failed", { err });
    return problems.internal(pathname);
  }
});
