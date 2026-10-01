import { createPublicClient } from "@/lib/supabase/clients";

export const dynamic = "force-dynamic";

// Readiness: can we reach the database? Details stay in the server log.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { error } = await createPublicClient().from("products").select("id", { head: true, count: "exact" });
    if (error) throw error;
    return Response.json({ status: "ready", checks: { database: "ok" } }, { headers });
  } catch (err) {
    console.error("readiness check failed", err);
    return Response.json({ status: "unavailable", checks: { database: "error" } }, { status: 503, headers });
  }
}
