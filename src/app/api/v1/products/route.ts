import { z } from "zod";
import { problems } from "@/lib/http/problem";
import { cursorParam, limitParam } from "@/lib/pagination";
import { listProducts, productCategory, productCursor } from "@/lib/products";
import { createPublicClient } from "@/lib/supabase/clients";

export const dynamic = "force-dynamic";

const query = z.object({
  limit: limitParam,
  cursor: cursorParam(productCursor).optional(),
  category: productCategory.optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return problems.badRequest(url.pathname, parsed.error);

  try {
    const page = await listProducts(createPublicClient(), parsed.data);
    return Response.json(page);
  } catch (err) {
    console.error("GET /api/v1/products failed", err);
    return problems.internal(url.pathname);
  }
}
