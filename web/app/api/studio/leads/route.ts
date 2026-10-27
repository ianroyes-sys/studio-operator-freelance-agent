import { NextRequest, NextResponse } from 'next/server';
import { workshopGuard } from '@/lib/server/workshop';
import { listLeads, updateLead, redraftLead, convertWonLead, runLeadPipeline, autopilotWonJob } from '@/scripts/studio-leads.mjs';
import { vetIsAutonomous } from '@/scripts/studio-vet.mjs';
import { openDeliveries } from '@/scripts/studio-deliver.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = workshopGuard(req); if (denied) return denied;
  try { return NextResponse.json(listLeads({ includeClosed: req.nextUrl.searchParams.get('closed') === '1' }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Leads could not be read. Existing records are preserved.' }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  const denied = workshopGuard(req); if (denied) return denied;
  let body: { action?: string; id?: string; priceUsd?: number; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    if (body.action === 'draft_now') return NextResponse.json(await runLeadPipeline({}));
    if (body.action === 'redraft') return NextResponse.json({ lead: await redraftLead(String(body.id)) });
    const lead = await updateLead({ id: String(body.id), action: String(body.action), priceUsd: body.priceUsd, reason: body.reason });
    if (body.action === 'won') {
      // Won work flows straight into Studio: job created with price and deadline, analyzed, and when the
      // analysis is a clean accept, approved and produced automatically. Final delivery stays with Ian.
      const { jobId, existing } = await convertWonLead(lead.id);
      // Vetted autonomous work goes to the studio-deliver loop (2026-10-26); everything else keeps the autopilot.
      if (vetIsAutonomous(lead.vet)) void openDeliveries().catch(() => {});
      else if (!existing) void autopilotWonJob(jobId).catch(() => {});
      return NextResponse.json({ lead, jobId });
    }
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lead action failed.' }, { status: 400 });
  }
}
