import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {readStudio,mutateStudio,calculateEconomics,makeJob,defaultSettings} from './studio-store.mjs';
import {analyzeStudioJob,editStudioAnalysis} from './studio-analysis.mjs';
import {approveStudioJob,startStudioProduction} from './studio-production.mjs';
import {validateQA,runStudioQA,addStudioRevision,approveStudioRevision,rejectStudioRevision,prepareStudioDelivery,approveStudioDelivery,recordStudioDelivery,repairStudioOutput} from './studio-qa.mjs';
async function waitRun(jobId){for(let i=0;i<100;i++){const s=await readStudio('demo');const j=s.jobs.find(j=>j.id===jobId);if(!j.generations.some(g=>['queued','running'].includes(g.status)))return s;await new Promise(r=>setTimeout(r,30));}throw new Error('Test worker did not finish');}
test('QA rejects contradictory pass claims and economics includes source minimum fees',()=>{
  assert.throws(()=>validateQA({checks:[{requirement:'Exact text',status:'fail',evidence:'Missing'}],verdict:'ready_for_review',repairReason:'',limitations:[]}),/contradicts/);
  const settings=defaultSettings(),job=makeJob({title:'Small fixed project',rawBrief:'Scope',budgetCents:1000,source:'Freelancer'},'live',settings);assert.equal(calculateEconomics(job,settings).channelFeeCents,500);
});
test('supervised demo: automatic QA, repair preserves old artifacts, revision and final human gate',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-qa-'));process.env.STUDIO_DATA_DIR=root;
  try{
    let state=await readStudio('demo');const jobId=state.jobs[0].id,input={mode:'demo',jobId};
    state=await analyzeStudioJob(input);const analysis={...state.jobs[0].analyses.edited,missingAssets:[],questionsForClient:[],rightsAndConsentFlags:[]};await editStudioAnalysis({...input,analysis});await approveStudioJob(input);
    await startStudioProduction(input);state=await waitRun(jobId);let job=state.jobs[0];assert.equal(job.qa.length,1);const firstOutput=job.outputs[0].id;
    await mutateStudio('demo',s=>{const report=s.jobs[0].qa[0];report.verdict='repair';report.repairReason='Demo controlled spelling repair';report.checks[0].status='fail';});
    await repairStudioOutput({...input,qaId:job.qa[0].id});state=await waitRun(jobId);job=state.jobs[0];assert.equal(job.generations.length,2);assert.ok(job.outputs.find(o=>o.id===firstOutput).supersededBy);
    await assert.rejects(repairStudioOutput({...input,qaId:job.qa[0].id}),/superseded/);
    await startStudioProduction(input);state=await waitRun(jobId);assert.equal(state.jobs[0].status,'qa');
    await assert.rejects(recordStudioDelivery({...input,evidence:'Test'}),/approval/);
    state=await addStudioRevision({...input,note:'Make the final introduction warmer.',deliverable:'Introduction'});const revisionId=state.jobs[0].revisions[0].id;
    await assert.rejects(prepareStudioDelivery(input),/pending client revisions/);
    await approveStudioRevision({...input,revisionId});await assert.rejects(startStudioProduction(input),/Approve/);await approveStudioJob(input);
    await startStudioProduction(input);state=await waitRun(jobId);assert.equal(state.jobs[0].revisions.length,1);
    await runStudioQA(input);await prepareStudioDelivery(input);await assert.rejects(approveStudioDelivery(input),/personally reviewed/);
    state=await readStudio('demo');const currentOutput=state.jobs[0].outputs.find(o=>!o.supersededBy),artifact=path.join(root,currentOutput.path),originalBytes=await fs.readFile(artifact);
    await fs.chmod(artifact,0o600);await fs.writeFile(artifact,'Changed after QA and package preparation');
    await assert.rejects(approveStudioDelivery({...input,acknowledgeReview:true}),/integrity changed/);
    await fs.writeFile(artifact,originalBytes);await fs.chmod(artifact,0o400);
    state=await addStudioRevision({...input,note:'Create a paid cinematic video.',deliverable:'Video'});const rejectedId=state.jobs[0].revisions.at(-1).id;
    state=await rejectStudioRevision({...input,revisionId:rejectedId,reason:'Outside the available text/source production catalog.'});assert.equal(state.jobs[0].revisions.at(-1).approval,'rejected');
    await approveStudioDelivery({...input,acknowledgeReview:true});await prepareStudioDelivery(input);await assert.rejects(recordStudioDelivery({...input,evidence:'Must reapprove new package'}),/approval/);
    await approveStudioDelivery({...input,acknowledgeReview:true});state=await recordStudioDelivery({...input,evidence:'Synthetic demo delivery confirmation only'});
    assert.equal(state.jobs[0].status,'delivered');assert.equal(state.jobs[0].paidCents,0);assert.equal((await readStudio('live')).jobs.length,0);
  }finally{delete process.env.STUDIO_DATA_DIR;await fs.rm(root,{recursive:true,force:true});}
});
