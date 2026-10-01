import { getAuth } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { problems } from "@/lib/http/problem";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = route({ rateLimit: { bucket: "cart", ...LIMITS.user } }, async (req: Request) => {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  try {
    return Response.json(await getCart(auth.db, auth.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("GET /api/v1/cart failed", { err });
    return problems.internal(pathname);
  }
});
