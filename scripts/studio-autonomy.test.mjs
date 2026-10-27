import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readStudio,mutateStudio} from './studio-store.mjs';
import {analyzeStudioJob,editStudioAnalysis} from './studio-analysis.mjs';
import {approveStudioJob,cancelStudioProduction,startStudioProduction,resolveStudioOutput} from './studio-production.mjs';
import {startApprovedWorkflow,nextApprovedStep,continueApprovedWorkflow} from './studio-autonomy.mjs';

async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-autonomy-'));process.env.STUDIO_DATA_DIR=root;
  try{const state=await readStudio('demo'),jobId=state.jobs[0].id;state.jobs[0].deadline='2099-01-01';await mutateStudio('demo',s=>Object.assign(s,state));
    const analyzed=await analyzeStudioJob({mode:'demo',jobId}),analysis={...analyzed.jobs[0].analyses.edited,missingAssets:[],questionsForClient:[],rightsAndConsentFlags:[]};
    await editStudioAnalysis({mode:'demo',jobId,analysis});await approveStudioJob({mode:'demo',jobId});await fn(jobId);
  }finally{delete process.env.STUDIO_DATA_DIR;await fs.rm(root,{recursive:true,force:true});}}
async function waitFor(jobId,predicate){for(let i=0;i<200;i++){const state=await readStudio('demo'),job=state.jobs.find(j=>j.id===jobId);if(predicate(job))return job;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out waiting for demo worker');}

test('approved demo workflow completes all steps and QA without delivery or messages',()=>fixture(async jobId=>{
  await startApprovedWorkflow({mode:'demo',jobId});
  const job=await waitFor(jobId,j=>j.workflowRun.status==='completed');
  assert.ok(job.workflow.length>1);assert.equal(job.status,'qa');assert.equal(job.generations.length,job.workflow.length);
  assert.ok(job.workflow.every(s=>s.status==='completed'));assert.ok(job.generations.every(g=>g.status==='completed'&&g.actualCostCents===0));
  assert.equal(job.deliveryApprovedAt,null);assert.equal(job.deliveryRecordedAt,undefined);assert.equal(job.messages?.length||0,0);
  assert.equal(job.paidCents,0);
}));

test('continuation gates fail closed on changed approvals, revisions, QA, spend and attempts',()=>fixture(async jobId=>{
  await startApprovedWorkflow({mode:'demo',jobId});await waitFor(jobId,j=>j.workflowRun.status==='completed');
  const state=await readStudio('demo'),base=state.jobs.find(j=>j.id===jobId);
  function check(change,pattern){const job=structuredClone(base),settings=structuredClone(state.settings);job.workflowRun.status='running';change(job,settings);assert.throws(()=>nextApprovedStep(job,settings),pattern);}
  check(j=>j.rawBrief+=' changed',/review and approve/);
  check(j=>j.revisions.push({approval:'pending'}),/revision/);
  check(j=>j.qa.at(-1).verdict='blocked',/QA blocked/);
  check(j=>j.qa.at(-1).checks.push({status:'human_review',requirement:'Verify rights',evidence:'Consent unclear'}),/human-review/);
  check(j=>{j.qa.at(-1).verdict='repair';},/human-review/);
  check(j=>j.qa.at(-1).outputHashes={},/fresh QA/);
  check((j,s)=>s.maxAutomaticSpendCents=1,/review and approve/);
  check(j=>j.generations.at(-1).status='failed',/did not complete/);
  const repair=structuredClone(base);repair.workflowRun.status='running';const report=repair.qa.at(-1);report.verdict='repair';report.checks=[{status:'fail',requirement:'Exact copy',evidence:'Missing word'}];
  assert.equal(nextApprovedStep(repair,state.settings).repair,true);
  const step=repair.workflow.find(s=>s.id===repair.generations.at(-1).stepId);
  while(repair.generations.filter(g=>g.stepId===step.id).length<step.maxAttempts)repair.generations.push({...repair.generations.at(-1),id:`attempt-${repair.generations.length}`});
  assert.throws(()=>nextApprovedStep(repair,state.settings),/attempt limit/);
}));

test('blocked QA pauses chaining; stopping a run prevents a late worker continuation',()=>fixture(async jobId=>{
  await startStudioProduction({mode:'demo',jobId});await waitFor(jobId,j=>j.generations[0].status==='completed');
  let generationId;
  await mutateStudio('demo',state=>{const job=state.jobs.find(j=>j.id===jobId);generationId=job.generations[0].id;
    job.workflowRun={id:'test-run',status:'running',approvalFingerprint:job.approvalFingerprint,lastGenerationId:generationId,startedAt:new Date().toISOString()};job.qa[0].verdict='blocked';});
  await continueApprovedWorkflow('demo',jobId,generationId);
  let job=(await readStudio('demo')).jobs.find(j=>j.id===jobId);assert.equal(job.workflowRun.status,'paused');assert.match(job.workflowRun.reason,/QA blocked/);assert.equal(job.generations.length,1);
  await mutateStudio('demo',state=>{const j=state.jobs.find(j=>j.id===jobId);j.workflowRun.status='running';j.qa[0].verdict='ready_for_review';});
  await cancelStudioProduction({mode:'demo',jobId,stopWorkflow:true});await continueApprovedWorkflow('demo',jobId,generationId);
  job=(await readStudio('demo')).jobs.find(j=>j.id===jobId);assert.equal(job.workflowRun.status,'stopped');assert.equal(job.generations.length,1);
}));

test('physical output tampering stops continuation before another attempt',()=>fixture(async jobId=>{
  await startStudioProduction({mode:'demo',jobId});let job=await waitFor(jobId,j=>j.generations[0].status==='completed');
  const generationId=job.generations[0].id,output=await resolveStudioOutput('demo',jobId,job.outputs[0].id);
  await fs.chmod(output.path,0o600);await fs.writeFile(output.path,'tampered bytes');
  await mutateStudio('demo',state=>{const j=state.jobs.find(j=>j.id===jobId);j.workflowRun={id:'tamper-run',status:'running',approvalFingerprint:j.approvalFingerprint,lastGenerationId:generationId,startedAt:new Date().toISOString()};});
  await continueApprovedWorkflow('demo',jobId,generationId);job=(await readStudio('demo')).jobs.find(j=>j.id===jobId);
  assert.equal(job.workflowRun.status,'paused');assert.match(job.workflowRun.reason,/integrity changed/);assert.equal(job.generations.length,1);
}));

test('a bounded automatic repair retains its attempt then completes the remaining demo route',()=>fixture(async jobId=>{
  await startStudioProduction({mode:'demo',jobId});await waitFor(jobId,j=>j.generations[0].status==='completed');
  let generationId;
  await mutateStudio('demo',state=>{const job=state.jobs.find(j=>j.id===jobId);generationId=job.generations[0].id;
    job.workflowRun={id:'repair-run',status:'running',approvalFingerprint:job.approvalFingerprint,lastGenerationId:generationId,startedAt:new Date().toISOString()};
    job.qa[0].verdict='repair';job.qa[0].checks=[{requirement:'Exact copy',status:'fail',evidence:'Synthetic missing word'}];job.qa[0].repairReason='Restore the missing word';});
  await continueApprovedWorkflow('demo',jobId,generationId);
  const job=await waitFor(jobId,j=>j.workflowRun.status==='completed');assert.equal(job.generations.length,job.workflow.length+1);
  assert.equal(job.generations[0].id,generationId);assert.ok(job.timeline.some(e=>e.action==='repair.automatic'));assert.equal(job.deliveryApprovedAt,null);
}));
