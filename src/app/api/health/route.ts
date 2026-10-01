export const dynamic = "force-dynamic";

// Liveness only — no dependency checks. Readiness (DB) lives at /api/ready.
export function GET() {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
