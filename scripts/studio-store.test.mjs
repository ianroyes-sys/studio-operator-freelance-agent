import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyStudioAction,readStudio,calculateEconomics,studioMetrics,defaultSettings,makeJob,mutateStudio} from './studio-store.mjs';
test('durable studio isolation, concurrency, validation, dedupe and economics',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-test-')); process.env.STUDIO_DATA_DIR=root;
  try {
    assert.equal((await readStudio()).jobs.length,0);
    assert.equal((await readStudio('demo')).jobs.length,2);
    assert.deepEqual((await readStudio('demo')).jobs,(await readStudio('demo')).jobs);
    await Promise.all(Array.from({length:12},(_,i)=>applyStudioAction({action:'create',title:`Job ${i}`,rawBrief:'A real user-provided brief.',budgetCents:10000})));
    const state=await readStudio(); assert.equal(state.jobs.length,12); assert.equal(state.revision,12); assert.equal(state.audit.length,12);
    await applyStudioAction({action:'reset_demo',mode:'demo'});
    assert.equal((await readStudio()).jobs.length,12); assert.equal(studioMetrics(await readStudio()).revenueCents,0);
    await assert.rejects(applyStudioAction({action:'reset_demo'}),/Only demo/);
    await assert.rejects(applyStudioAction({action:'create',title:'bad',rawBrief:'x',budgetCents:-1}),/budgetCents/);
    await assert.rejects(applyStudioAction({action:'settings',settings:{paidProvidersEnabled:true}}),/not connected/);
    await assert.rejects(applyStudioAction({action:'settings',settings:{maxAutomaticSpendCents:1}}),/disabled/);
    await applyStudioAction({action:'create',title:'Listing',rawBrief:'Scope',budgetCents:12345,sourceUrl:'https://example.com/job/1'});
    await assert.rejects(applyStudioAction({action:'create',title:'Duplicate',rawBrief:'Scope',sourceUrl:'https://example.com/job/1'}),/already/);
    const settings=defaultSettings(); const job=makeJob({title:'Math',rawBrief:'Scope',budgetCents:10001},'live',settings);
    job.workflow=[{estimatedAttempts:3,unitCostCents:11}]; job.generations=[{actualCostCents:11}];
    assert.deepEqual(calculateEconomics(job,settings),{clientPriceCents:10001,channelFeeCents:2001,estimatedSpendCents:33,actualSpendCents:11,contingencyCents:5,expectedProfitCents:7962,marginBps:7961,withinBudget:false});
    const before=await readStudio(); await assert.rejects(mutateStudio('live',s=>{s.jobs=[];throw new Error('abort');}));
    assert.deepEqual(await readStudio(),before);
    await fs.writeFile(path.join(root,'state.json'),'{broken'); await assert.rejects(readStudio());
  } finally {delete process.env.STUDIO_DATA_DIR; await fs.rm(root,{recursive:true,force:true});}
});
