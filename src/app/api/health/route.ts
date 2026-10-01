import { route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

// Liveness only — no dependency checks. Readiness (DB) lives at /api/ready.
export const GET = route({}, () => {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
