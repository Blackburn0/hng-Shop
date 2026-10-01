import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { problems } from "@/lib/http/problem";
import { getOrder } from "@/lib/orders";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const params = z.object({ id: z.uuid("must be a UUID") });

/** One of the caller's orders. Someone else's order is indistinguishable from a missing one (404). */
export const GET = route({ rateLimit: { bucket: "orders.read", ...LIMITS.user } }, async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const p = params.safeParse(await ctx.params);
  if (!p.success) return problems.badRequest(pathname, p.error);

  try {
    const order = await getOrder(auth.db, p.data.id);
    if (!order) return problems.notFound(pathname, "No such order.");
    return Response.json(order, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("GET /api/v1/orders/[id] failed", { err });
    return problems.internal(pathname);
  }
});
