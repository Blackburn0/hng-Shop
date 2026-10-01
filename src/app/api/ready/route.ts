import { createPublicClient } from "@/lib/supabase/clients";
import { route } from "@/lib/http/route";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// Readiness: can we reach the database? Details stay in the server log.
export const GET = route({}, async () => {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { error } = await createPublicClient().from("products").select("id", { head: true, count: "exact" });
    if (error) throw error;
    return Response.json({ status: "ready", checks: { database: "ok" } }, { headers });
  } catch (err) {
    log.error("readiness check failed", { err });
    return Response.json({ status: "unavailable", checks: { database: "error" } }, { status: 503, headers });
  }
});
