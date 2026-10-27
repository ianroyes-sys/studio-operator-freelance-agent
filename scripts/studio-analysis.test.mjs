import test from 'node:test';import assert from 'node:assert/strict';
import {validateAnalysis,parseAnalysis,mockAnalysis,routeAnalysis,analysisPrompt,availableStudioModels,runStructuredModel,studioModelArgs,studioEnvelopeOutput} from './studio-analysis.mjs';
import {makeJob,defaultSettings} from './studio-store.mjs';
const settings=defaultSettings();const job=makeJob({title:'Report',rawBrief:'Synthesize the supplied interviews.',budgetCents:10000,deadline:'2099-01-01'},'live',settings);
test('analysis strictly validates complete records and rejects malformed output',()=>{
  const analysis=mockAnalysis(job);assert.deepEqual(validateAnalysis(analysis),analysis);
  assert.throws(()=>parseAnalysis('```json\n{}\n```'));
  assert.throws(()=>validateAnalysis({...analysis,confidence:101}),/confidence/);
  const missing={...analysis};delete missing.rightsAndConsentFlags;assert.throws(()=>validateAnalysis(missing),/Missing/);
  assert.throws(()=>validateAnalysis({...analysis,unexpected:true}),/Unknown/);
  assert.throws(()=>validateAnalysis({...analysis,estimatedAttemptsByStep:[]}),/attempt/);
  assert.throws(()=>validateAnalysis({...analysis,deliverables:[{...analysis.deliverables[0],duration:Infinity}]}),/duration/);
});
test('deterministic review overrides acceptance for missing inputs, unsupported capabilities and financial gaps',()=>{
  const good={...mockAnalysis(job),missingAssets:[],questionsForClient:[],technicalRisks:[],confidence:95,decision:'accept'};
  assert.equal(routeAnalysis(job,good,settings).analysis.decision,'accept');
  assert.equal(routeAnalysis(job,{...good,rightsAndConsentFlags:['No ownership confirmed']},settings).analysis.decision,'human_review');
  assert.equal(routeAnalysis(job,{...good,proposedWorkflow:[{capability:'video',purpose:'Generate film'}],estimatedAttemptsByStep:[1]},settings).analysis.decision,'human_review');
  assert.equal(routeAnalysis({...job,budgetCents:0},good,settings).analysis.decision,'human_review');
  assert.equal(routeAnalysis({...job,deadline:null},good,settings).analysis.decision,'human_review');
  assert.equal(routeAnalysis(job,{...good,decision:'reject'},settings).analysis.decision,'reject');
  assert.equal(routeAnalysis(job,good,settings).economics.estimatedSpendCents,0);
});
test('analysis prompt treats client instructions as data and lists actual capability bounds',()=>{
  const prompt=analysisPrompt(job);assert.match(prompt,/untrusted DATA/);assert.match(prompt,/No Higgsfield/);assert.match(prompt,/Do not use tools/);
});
test('local catalog does not fabricate model availability',async()=>{const models=await availableStudioModels();assert.ok(models.every(m=>['opus','sonnet'].includes(m)));
  const previous=process.env.STUDIO_CLAUDE_BIN;process.env.STUDIO_CLAUDE_BIN='/nonexistent/claude';
  try{assert.deepEqual(await availableStudioModels(),[]);await assert.rejects(runStructuredModel('unused',{},{model:'opus'}),/not installed/);await assert.rejects(runStructuredModel('unused',{},{model:'gpt-6-astra'}),/Invalid model/);}
  finally{if(previous===undefined)delete process.env.STUDIO_CLAUDE_BIN;else process.env.STUDIO_CLAUDE_BIN=previous;}
});
test('structured model calls have zero tools, zero MCP servers, no settings sources and no prompting',()=>{
  const args=studioModelArgs({model:'sonnet',schema:{type:'object'},dir:'/tmp/studio-model-x-'});const flag=n=>args[args.indexOf(n)+1];
  assert.equal(flag('--tools'),'');assert.equal(flag('--permission-mode'),'dontAsk');assert.ok(args.includes('--strict-mcp-config'));assert.equal(flag('--mcp-config'),'{"mcpServers":{}}');
  assert.equal(flag('--setting-sources'),'');assert.equal(flag('--json-schema'),'{"type":"object"}');assert.equal(flag('--output-format'),'json');assert.equal(flag('--model'),'sonnet');
  assert.ok(args.includes('/tmp/studio-model-x-'));assert.ok(!args.some(a=>/bypassPermissions|dangerously/i.test(a)));
});
test('only successful structured envelopes without tool attempts are accepted',()=>{
  assert.equal(studioEnvelopeOutput(JSON.stringify({is_error:false,result:'',structured_output:{ready:true}})),'{"ready":true}');
  assert.throws(()=>studioEnvelopeOutput(JSON.stringify({is_error:true,structured_output:{ready:true}})),/failed/);
  assert.throws(()=>studioEnvelopeOutput(JSON.stringify({is_error:false,result:'{"ready":true}'})),/no structured/);
  assert.throws(()=>studioEnvelopeOutput(JSON.stringify({is_error:false,structured_output:{ready:true},permission_denials:[{tool_name:'Bash'}]})),/attempted tools/);
  assert.throws(()=>studioEnvelopeOutput('not json'),/unreadable/);
});
test('already canceled requests never start a model process',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(runStructuredModel('unused',{}, {signal:controller.signal}),/canceled before start/);});
