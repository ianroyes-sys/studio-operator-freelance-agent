import test from 'node:test';import assert from 'node:assert/strict';
import {approvalFingerprint,assertApproval,studioCatalog} from './studio-router.mjs';
import {makeJob,defaultSettings,normalizeStudioModels,validateSettings} from './studio-store.mjs';
import {mockAnalysis,routeAnalysis} from './studio-analysis.mjs';
test('approval binds every scoped term, route and setting but not execution status',()=>{
  const settings=defaultSettings(),job=makeJob({title:'Test',rawBrief:'Complete scope',budgetCents:10000},'live',settings);
  job.workflow=routeAnalysis(job,mockAnalysis(job),settings).workflow;job.approvedAt=new Date().toISOString();job.approvalFingerprint=approvalFingerprint(job,settings);
  assert.doesNotThrow(()=>assertApproval(job,settings));job.workflow[0].status='completed';assert.doesNotThrow(()=>assertApproval(job,settings));
  assert.throws(()=>assertApproval({...job,budgetCents:10001},settings),/changed/);
  assert.throws(()=>assertApproval(job,{...settings,maxAttemptsPerStep:1}),/changed/);
  job.workflow[0].model='sonnet';assert.throws(()=>assertApproval(job,settings),/changed/);
});
test('plans approved under legacy Codex model ids stay approved after the read-time mapping',()=>{
  const legacySettings={...defaultSettings(),allowedModels:['gpt-6-astra','gpt-6-sol']};
  const job=makeJob({title:'Legacy',rawBrief:'Complete scope',budgetCents:10000},'live',legacySettings);
  job.workflow=routeAnalysis(job,mockAnalysis(job),defaultSettings()).workflow.map(s=>({...s,model:'gpt-6-astra',alternative:'gpt-6-sol'}));
  job.approvedAt=new Date().toISOString();job.approvalFingerprint=approvalFingerprint(job,legacySettings);
  const state=normalizeStudioModels({settings:legacySettings,jobs:[job]});
  assert.deepEqual(state.settings.allowedModels,['opus','sonnet']);assert.equal(job.workflow[0].model,'opus');assert.equal(job.workflow[0].alternative,'sonnet');
  assert.doesNotThrow(()=>assertApproval(job,state.settings));
  job.budgetCents=20000;assert.throws(()=>assertApproval(job,state.settings),/changed/);
  assert.deepEqual(validateSettings({allowedModels:['gpt-6-sol','sonnet']}).allowedModels,['sonnet']);
  assert.throws(()=>validateSettings({allowedModels:['gpt-5']}),/allowedModels/);
});
test('routing prefers Opus and falls back explicitly to Sonnet when Opus is disabled',async()=>{
  const settings=defaultSettings(),job=makeJob({title:'Code',rawBrief:'Build HTML',budgetCents:10000},'live',settings);
  const analysis={...mockAnalysis(job),proposedWorkflow:[{capability:'code',purpose:'Build page'}],estimatedAttemptsByStep:[1]};
  const routed=routeAnalysis(job,analysis,settings,['opus','sonnet']);assert.equal(routed.workflow[0].model,'opus');assert.equal(routed.workflow[0].alternative,'sonnet');
  const fallback=routeAnalysis(job,analysis,{...settings,allowedModels:['sonnet']},['opus','sonnet']);assert.equal(fallback.workflow[0].model,'sonnet');assert.match(fallback.workflow[0].rationale,/Opus is disabled/);
  const catalog=await studioCatalog();assert.deepEqual(catalog.map(m=>m.id),['opus','sonnet']);assert.ok(catalog.every(m=>m.incrementalCostCents===0&&m.provider==='Local Claude Code (MAX subscription)'));
});
