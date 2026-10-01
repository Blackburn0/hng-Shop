import { z } from "zod";
import { problems } from "@/lib/http/problem";
import { getProductBySlug, productSlug } from "@/lib/products";
import { createPublicClient } from "@/lib/supabase/clients";

export const dynamic = "force-dynamic";

const params = z.object({ slug: productSlug });

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { pathname } = new URL(req.url);
  const parsed = params.safeParse(await ctx.params);
  if (!parsed.success) return problems.badRequest(pathname, parsed.error);

  try {
    const product = await getProductBySlug(createPublicClient(), parsed.data.slug);
    if (!product) return problems.notFound(pathname, `No product with slug "${parsed.data.slug}".`);
    return Response.json(product);
  } catch (err) {
    console.error("GET /api/v1/products/[slug] failed", err);
    return problems.internal(pathname);
  }
}
