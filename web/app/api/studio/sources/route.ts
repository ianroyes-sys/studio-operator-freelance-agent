import { NextRequest, NextResponse } from 'next/server';
import { workshopGuard } from '@/lib/server/workshop';
import { readSources, refreshSources, shortlistListing } from '@/scripts/studio-sources.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req:NextRequest) {
  const denied = workshopGuard(req); if (denied) return denied;
  try { return NextResponse.json(readSources(), { headers:{'Cache-Control':'no-store'} }); }
  catch { return NextResponse.json({error:'Discovery data could not be read. Existing records are preserved.'},{status:503}); }
}
export async function POST(req:NextRequest) {
  const denied = workshopGuard(req); if (denied) return denied;
  try {
    const body = await req.json();
    if (body.action === 'refresh') return NextResponse.json(await refreshSources());
    if (body.action === 'shortlist') return NextResponse.json(shortlistListing(body.id,body.value));
    return NextResponse.json({error:'Unknown discovery action.'},{status:400});
  } catch { return NextResponse.json({error:'Discovery could not complete this action. Retry after the current refresh.'},{status:400}); }
}
