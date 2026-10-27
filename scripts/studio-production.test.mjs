import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {applyStudioAction,readStudio,mutateStudio} from './studio-store.mjs';
import {analyzeStudioJob,editStudioAnalysis} from './studio-analysis.mjs';
import {validateBundle,approveStudioJob,startStudioProduction,resolveStudioOutput,recoverStudioRuns,readProductionContext} from './studio-production.mjs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
test('output bundle rejects traversal, duplicate names, unsafe extensions and excessive payloads',()=>{
  const b={files:[{name:'index.html',content:'<!doctype html><h1>Hello</h1>'}],summary:'Done',limitations:[]};assert.equal(validateBundle(b),b);
  for(const name of ['../secret.txt','/etc/passwd','folder/a.txt','x.exe','a..txt'])assert.throws(()=>validateBundle({...b,files:[{name,content:'x'}]}));
  assert.throws(()=>validateBundle({...b,files:[{name:'a.txt',content:'x'},{name:'A.txt',content:'y'}]}),/Duplicate/);
  assert.throws(()=>validateBundle({...b,files:[{name:'a.txt',content:'x'.repeat(2000001)}]}),/large/);
});
test('detached demo production survives request completion, preserves attempts, downloads isolated artifacts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-production-'));process.env.STUDIO_DATA_DIR=root;
  try{
    let state=await readStudio('demo');const jobId=state.jobs[0].id;
    // Persist this exact ephemeral demo snapshot before analysis.
    await mutateStudio('demo',s=>Object.assign(s,state));
    state=await analyzeStudioJob({mode:'demo',jobId});await assert.rejects(approveStudioJob({mode:'demo',jobId}),/Resolve/);
    const analysis={...state.jobs.find(j=>j.id===jobId).analyses.edited,missingAssets:[],questionsForClient:[],rightsAndConsentFlags:[]};
    await editStudioAnalysis({mode:'demo',jobId,analysis});await approveStudioJob({mode:'demo',jobId});
    await startStudioProduction({mode:'demo',jobId});
    for(let i=0;i<100;i++){state=await readStudio('demo');if(state.jobs.find(j=>j.id===jobId).generations[0].status==='completed')break;await new Promise(r=>setTimeout(r,40));}
    const job=state.jobs.find(j=>j.id===jobId);assert.equal(job.generations[0].status,'completed');assert.equal(job.generations[0].actualCostCents,0);assert.equal(job.outputs.length,1);
    const output=await resolveStudioOutput('demo',jobId,job.outputs[0].id);assert.match(await fs.readFile(output.path,'utf8'),/synthetic demo/);
    await fs.chmod(output.path,0o600);await fs.writeFile(output.path,'changed');await assert.rejects(resolveStudioOutput('demo',jobId,job.outputs[0].id),/integrity changed/);
    for(const size of [35000,180001]){const content='x'.repeat(size);await fs.writeFile(output.path,content);await mutateStudio('demo',s=>{const o=s.jobs.find(j=>j.id===jobId).outputs[0];o.sha256=createHash('sha256').update(content).digest('hex');o.byteLength=size;});
      if(size===35000)assert.equal((await readProductionContext('demo',job))[0].content.length,35000);else await assert.rejects(readProductionContext('demo',job),/Nothing was silently truncated/);
    }
    assert.equal(await resolveStudioOutput('live',jobId,job.outputs[0].id),null);
    await mutateStudio('demo',s=>{const j=s.jobs.find(j=>j.id===jobId);j.outputs[0].path='../../outside.txt';});assert.equal(await resolveStudioOutput('demo',jobId,job.outputs[0].id),null);
    const orphan=spawn(process.execPath,['-e','setInterval(()=>{},1000)','claude','studio-model-test-'],{detached:true,stdio:'ignore'});
    await new Promise(r=>orphan.once('spawn',r));const orphanClosed=new Promise(r=>orphan.once('exit',r));
    await mutateStudio('demo',s=>{const j=s.jobs.find(j=>j.id===jobId);j.generations.push({...j.generations[0],id:'dead',status:'running',workerPid:2147483647,modelPid:orphan.pid,modelRunToken:'test',createdAt:'2000-01-01'});});
    const recovered=await recoverStudioRuns('demo');assert.equal(recovered.jobs.find(j=>j.id===jobId).generations[1].status,'failed');
    const recoveryTimeout=setTimeout(()=>orphan.kill('SIGTERM'),2000);
    await orphanClosed;clearTimeout(recoveryTimeout);assert.equal(orphan.signalCode,'SIGKILL','Run this process-identity test outside the process-inspection sandbox');
    assert.equal((await readStudio()).jobs.length,0);
  }finally{delete process.env.STUDIO_DATA_DIR;await fs.rm(root,{recursive:true,force:true});}
});
