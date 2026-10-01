import { z } from "zod";
import { problems } from "@/lib/http/problem";
import { getProductBySlug, productSlug } from "@/lib/products";
import { createPublicClient } from "@/lib/supabase/clients";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const params = z.object({ slug: productSlug });

export const GET = route({ rateLimit: { bucket: "products", ...LIMITS.read } }, async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { pathname } = new URL(req.url);
  const parsed = params.safeParse(await ctx.params);
  if (!parsed.success) return problems.badRequest(pathname, parsed.error);

  try {
    const product = await getProductBySlug(createPublicClient(), parsed.data.slug);
    if (!product) return problems.notFound(pathname, `No product with slug "${parsed.data.slug}".`);
    return Response.json(product);
  } catch (err) {
    log.error("GET /api/v1/products/[slug] failed", { err });
    return problems.internal(pathname);
  }
});
