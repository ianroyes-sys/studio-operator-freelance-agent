import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {saveStudioClient,draftStudioMessage,reviewStudioMessage,createStudioTemplateJob,addStudioLesson,validateClientMemory} from './studio-client.mjs';
import {readStudio,applyStudioAction} from './studio-store.mjs';
import {analysisPrompt} from './studio-analysis.mjs';
test('client memory validates shapes and bounded preferences',()=>{assert.throws(()=>validateClientMemory({name:'Client',colors:'red'}),/colors/);assert.throws(()=>validateClientMemory({name:'Client',id:'../../bad'}),/id/);});
test('templates, versioned memory, all communication drafts and lessons stay local and audited',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-client-'));process.env.STUDIO_DATA_DIR=root;
  try{
    assert.equal((await readStudio()).templates.length,3);
    let state=await createStudioTemplateJob({mode:'demo',templateId:'copy-documentation',rawBrief:'Approved fictional facts: opens at 8am. Write a short introduction.',budgetCents:5000});const jobId=state.jobs[0].id;
    state=await saveStudioClient({mode:'demo',jobId,client:{name:'Fictional Client',tone:'Warm and clear',colors:['#123456']}});const client=state.clients[0];assert.equal(state.jobs[0].clientMemorySnapshot.tone,'Warm and clear');assert.match(analysisPrompt(state.jobs[0]),/Warm and clear/);
    await saveStudioClient({mode:'demo',client:{...client,tone:'A new preference for future jobs'}});state=await readStudio('demo');assert.equal(state.jobs[0].clientMemorySnapshot.tone,'Warm and clear');
    for(const kind of ['intake','proposal','progress','concepts','revision','change_order','delivery','follow_up'])state=await draftStudioMessage({mode:'demo',jobId,kind});
    assert.equal(state.jobs[0].messages.length,8);assert.ok(state.jobs[0].messages.every(m=>m.status==='draft'));
    state=await reviewStudioMessage({mode:'demo',jobId,messageId:state.jobs[0].messages[0].id});assert.equal(state.jobs[0].messages[0].status,'reviewed');
    await assert.rejects(applyStudioAction({mode:'demo',action:'send_message',jobId}),/Unknown/);
    await assert.rejects(applyStudioAction({mode:'demo',action:'settings',settings:{automaticMessages:['progress']}}),/not connected/);
    state=await addStudioLesson({mode:'demo',jobId,lesson:'Require approved source facts.',evidence:'Synthetic intake question recorded in message draft.'});assert.equal(state.lessons.length,1);
    assert.equal((await readStudio()).jobs.length,0);
  }finally{delete process.env.STUDIO_DATA_DIR;await fs.rm(root,{recursive:true,force:true});}
});
