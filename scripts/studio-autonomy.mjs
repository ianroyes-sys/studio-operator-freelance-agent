import {readStudio,mutateStudio,audit,uid,now,calculateEconomics} from './studio-store.mjs';
import {assertApproval} from './studio-router.mjs';

// Deterministic gate used again inside the queue transaction; a stale worker cannot
// resume a stopped run, cross a changed approval, or silently skip failed QA.
export function nextApprovedStep(job,settings) {
  assertApproval(job,settings);
  const run=job.workflowRun;
  if(!run||run.status!=='running'||run.approvalFingerprint!==job.approvalFingerprint)throw new Error('Approved workflow run is no longer active');
  const analysis=job.analyses.edited;
  if(!analysis||analysis.decision==='reject'||analysis.rightsAndConsentFlags.length||analysis.missingAssets.length||analysis.questionsForClient.length)throw new Error('Scope, missing inputs or rights require human review');
  if(job.revisions.some(r=>r.approval==='pending'))throw new Error('Client revision requires human review');
  if(!job.deadline||Date.parse(job.deadline)<=Date.now())throw new Error('Deadline needs human review before continuing');
  const economics=calculateEconomics(job,settings);
  if(!economics.withinBudget||economics.expectedProfitCents<0||settings.maxAutomaticSpendCents!==0||settings.maxRepairSpendCents!==0)throw new Error('Automatic production must remain inside the approved zero-spend budget');
  if(job.generations.some(g=>['queued','running'].includes(g.status)))throw new Error('A production attempt is already active');
  let repairStep=null;
  // Inspect current output QA, not only the most recently generated step.
  for(const output of job.outputs.filter(o=>!o.supersededBy)) {
    const report=job.qa?.filter(q=>q.outputIds.includes(output.id)).at(-1);
    if(!report||report.approvalFingerprint!==job.approvalFingerprint||report.outputHashes?.[output.id]!==output.sha256)throw new Error('Current output needs fresh QA');
    if(report.verdict==='blocked')throw new Error('QA blocked production; human review required');
    if(report.checks.some(c=>c.status==='human_review'&&!(job.demo&&report.model==='demo'&&report.verdict==='ready_for_review'&&c.requirement==='Client suitability'&&c.evidence==='Demo fixture is not a real client deliverable.')))throw new Error('QA contains unresolved human-review findings');
    if(report.verdict==='repair') {
      if(report.checks.some(c=>c.status==='human_review'))throw new Error('Repair includes unresolved human-review findings');
      const generation=job.generations.find(g=>g.id===report.generationId);
      const step=job.workflow.find(s=>s.id===generation?.stepId);
      if(!step)throw new Error('Repair has no verified production step');
      if(repairStep&&repairStep.id!==step.id)throw new Error('Multiple repairs require human review');
      repairStep=step;
    } else if(report.verdict!=='ready_for_review'||report.checks.some(c=>c.status==='fail'))throw new Error('QA findings require human review');
  }
  if(run.lastGenerationId) {
    const last=job.generations.find(g=>g.id===run.lastGenerationId);
    if(last?.status!=='completed')throw new Error('Production attempt did not complete; retry requires human action');
  }
  const step=repairStep||job.workflow.find(s=>s.status!=='completed');
  if(!step)return {complete:true};
  if(!settings.allowedModels.includes(step.model)||step.unitCostCents!==0||step.maxSpendCents!==0)throw new Error('Selected model or spend requires review');
  if(job.generations.filter(g=>g.stepId===step.id).length>=Math.min(step.maxAttempts,settings.maxAttemptsPerStep))throw new Error('Approved attempt limit reached; human review required');
  return {complete:false,stepId:step.id,repair:!!repairStep};
}

export async function pauseStudioWorkflow(mode,jobId,runId,reason,status='paused') {
  return mutateStudio(mode,state=>{const job=state.jobs.find(j=>j.id===jobId);
    if(job?.workflowRun?.id!==runId||job.workflowRun.status!=='running')return state;
    Object.assign(job.workflowRun,{status,reason,endedAt:now()});
    audit(state,`workflow_run.${status}`,reason,job,'system');return state;
  });
}

export async function startApprovedWorkflow(input) {
  const mode=input.mode||'live',runId=uid();
  await mutateStudio(mode,state=>{const job=state.jobs.find(j=>j.id===input.jobId);if(!job)throw new Error('Job not found');
    if(!['approved','qa'].includes(job.status)||job.workflowRun?.status==='running')throw new Error('Approve the workflow and stop any existing run first');
    job.workflowRun={id:runId,status:'running',approvalFingerprint:job.approvalFingerprint,startedAt:now(),lastGenerationId:null};
    const next=nextApprovedStep(job,state.settings);if(next.complete)throw new Error('Production is already complete; review delivery');
    audit(state,'workflow_run.started','Human started the approved workflow. Zero paid spend; bounded repairs; final delivery remains human-approved.',job);
  });
  try {const {startStudioProduction}=await import('./studio-production.mjs');return await startStudioProduction({mode,jobId:input.jobId,workflowRunId:runId});}
  catch(error){await pauseStudioWorkflow(mode,input.jobId,runId,error.message);throw error;}
}

export async function continueApprovedWorkflow(mode,jobId,generationId) {
  const state=await readStudio(mode),job=state.jobs.find(j=>j.id===jobId),run=job?.workflowRun;
  if(!run||run.status!=='running'||run.lastGenerationId!==generationId)return;
  try {
    const next=nextApprovedStep(job,state.settings);
    if(next.complete){
      const {verifyStudioOutputs}=await import('./studio-production.mjs');await verifyStudioOutputs(mode,job);
      await mutateStudio(mode,current=>{const latest=current.jobs.find(j=>j.id===jobId);
        if(latest?.workflowRun?.id!==run.id||latest.workflowRun.status!=='running'||latest.workflowRun.lastGenerationId!==generationId)return;
        if(!nextApprovedStep(latest,current.settings).complete)throw new Error('Workflow changed before completion');
        Object.assign(latest.workflowRun,{status:'completed',endedAt:now(),reason:'Production and advisory QA complete. Review outputs and approve final delivery; nothing sent.'});
        audit(current,'workflow_run.completed',latest.workflowRun.reason,latest,'system');
      });return;
    }
    const {startStudioProduction}=await import('./studio-production.mjs');
    await startStudioProduction({mode,jobId,workflowRunId:run.id,previousGenerationId:generationId});
  }catch(error){await pauseStudioWorkflow(mode,jobId,run.id,error.message);}
}
