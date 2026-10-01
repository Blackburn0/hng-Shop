import { getAuth } from "@/lib/auth";
import { getCart, mergeBody, mergeItems } from "@/lib/cart";
import { problems, readJson } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

/** Merge the guest (localStorage) cart into the signed-in user's cart. */
export async function POST(req: Request) {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const json = await readJson(req);
  if (!json.ok) return problems.malformedJson(pathname);
  const body = mergeBody.safeParse(json.value);
  if (!body.success) return problems.validation(pathname, body.error);

  try {
    const { skipped } = await mergeItems(auth.db, auth.user.id, body.data.items);
    const cart = await getCart(auth.db, auth.user.id);
    return Response.json({ ...cart, skipped }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("POST /api/v1/cart/merge failed", err);
    return problems.internal(pathname);
  }
}
