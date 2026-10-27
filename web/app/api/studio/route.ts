import { NextRequest, NextResponse } from 'next/server';
import { readStudio, applyStudioAction, studioMetrics } from '@/scripts/studio-store.mjs';
import { studioAuthorized, studioMutationOrigin } from '@/lib/server/studioAuth';
import { analyzeStudioJob, editStudioAnalysis } from '@/scripts/studio-analysis.mjs';
import { approveStudioJob,startStudioProduction,cancelStudioProduction,testStudioConnection,recoverStudioRuns } from '@/scripts/studio-production.mjs';
import {studioCatalog,overrideStudioRoute} from '@/scripts/studio-router.mjs';
import {runStudioQA,addStudioRevision,approveStudioRevision,rejectStudioRevision,repairStudioOutput,prepareStudioDelivery,approveStudioDelivery,recordStudioDelivery} from '@/scripts/studio-qa.mjs';
import {saveStudioClient,draftStudioMessage,reviewStudioMessage,createStudioTemplateJob,addStudioLesson} from '@/scripts/studio-client.mjs';
import {startApprovedWorkflow} from '@/scripts/studio-autonomy.mjs';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=300;
export async function GET(req: NextRequest) {
  if(!studioAuthorized(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const mode=req.nextUrl.searchParams.get('mode') || 'live';
  if(mode!=='live' && mode!=='demo') return NextResponse.json({error:'Invalid mode'},{status:400});
  try {const state=await recoverStudioRuns(mode); return NextResponse.json({state,metrics:studioMetrics(state),catalog:await studioCatalog()},{headers:{'Cache-Control':'no-store'}});}
  catch {return NextResponse.json({error:'Studio data could not be read. Existing records were preserved.'},{status:500});}
}
export async function POST(req: NextRequest) {
  if(!studioAuthorized(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
  if(!studioMutationOrigin(req)) return NextResponse.json({error:'Invalid request origin'},{status:403});
  try {
    const raw=await req.text(); if(raw.length>100000) return NextResponse.json({error:'Request too large'},{status:413});
    const input=JSON.parse(raw);
    if(input.action==='connection_test') return NextResponse.json(await testStudioConnection(input.model||'opus'));
    const qaActions:Record<string,(input:Record<string,unknown>)=>Promise<import('@/lib/studio').StudioState>>={qa:runStudioQA,add_revision:addStudioRevision,approve_revision:approveStudioRevision,reject_revision:rejectStudioRevision,repair:repairStudioOutput,prepare_delivery:prepareStudioDelivery,approve_delivery:approveStudioDelivery,record_delivery:recordStudioDelivery,save_client:saveStudioClient,draft_message:draftStudioMessage,review_message:reviewStudioMessage,create_template_job:createStudioTemplateJob,add_lesson:addStudioLesson};
    if(Object.hasOwn(qaActions,input.action)){const state=await qaActions[input.action](input);return NextResponse.json({state,metrics:studioMetrics(state),catalog:await studioCatalog()});}
    const state=input.action==='analyze'?await analyzeStudioJob(input):input.action==='edit_analysis'?await editStudioAnalysis(input):input.action==='approve'?await approveStudioJob(input):input.action==='run_workflow'?await startApprovedWorkflow(input):input.action==='run'?await startStudioProduction({mode:input.mode,jobId:input.jobId}):input.action==='cancel'?await cancelStudioProduction(input):input.action==='override_route'?await overrideStudioRoute(input):await applyStudioAction(input);
    return NextResponse.json({state,metrics:studioMetrics(state),catalog:await studioCatalog()});
  } catch(error) {return NextResponse.json({error:error instanceof SyntaxError?'Invalid JSON':error instanceof Error?error.message:'Request failed'},{status:400});}
}
