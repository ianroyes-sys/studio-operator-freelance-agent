import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {studioTemplates} from './studio-templates.mjs';

export const studioRoot = () => path.resolve(process.env.STUDIO_DATA_DIR || path.join(process.cwd(), 'data/studio'));
export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
export function text(value, name, max = 30000, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function integer(value, name, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
// Studio production models run through local Claude Code (MAX subscription). Opus is the default
// slot (formerly Astra); Sonnet is the alternative slot (formerly Sol). The legacy map is applied at read
// time to forward-looking routing config only (settings and workflow steps). Generation, QA and message
// records keep the model that actually produced them.
export const STUDIO_MODELS = Object.freeze(['opus','sonnet']);
export const LEGACY_STUDIO_MODELS = Object.freeze({'gpt-6-astra':'opus','gpt-6-sol':'sonnet'});
export const studioModel = value => LEGACY_STUDIO_MODELS[value] || value;
export function legacyStudioModel(value) { return Object.entries(LEGACY_STUDIO_MODELS).find(([,model])=>model===value)?.[0] || value; }
export function normalizeStudioModels(state) {
  if (Array.isArray(state.settings?.allowedModels)) {
    const allowed=[...new Set(state.settings.allowedModels.map(studioModel))].filter(m=>STUDIO_MODELS.includes(m));
    state.settings.allowedModels=allowed.length?allowed:[...STUDIO_MODELS];
  }
  for (const job of state.jobs) for (const step of job.workflow || []) {
    if (step.model) step.model=studioModel(step.model);
    if (step.alternative) step.alternative=studioModel(step.alternative);
  }
  return state;
}
function modeCheck(mode) { if (!['live','demo'].includes(mode)) throw new Error('Invalid mode'); return mode; }
export function defaultSettings() { return {
  channelFeeBps: 2000, contingencyBps: 1500, targetMarginBps: 6000, maxAutomaticSpendCents: 0,
  maxRepairSpendCents: 0, maxAttemptsPerStep: 3, allowedModels: [...STUDIO_MODELS],
  automaticMessages: [], shareConceptsAutomatically: false, finalDeliveryRequiresApproval: true,
  pauseConditions: ['unclear rights','identity or likeness','factual claims','negative margin','deadline risk','client dispute'], paidProvidersEnabled: false,
}; }
export function makeJob(input, mode, settings) {
  const deadline = input.deadline ? text(input.deadline,'deadline',50) : null;
  if (deadline && !Number.isFinite(Date.parse(deadline))) throw new Error('Invalid deadline');
  const sourceUrl = text(input.sourceUrl,'sourceUrl',2000,true);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('Invalid sourceUrl');
  return { id: uid(), title: text(input.title,'title',200), rawBrief: text(input.rawBrief,'brief'),
    source: text(input.source || 'Manual','source',100), sourceUrl, sourceId: text(input.sourceId,'sourceId',300,true),
    budgetCents: integer(input.budgetCents ?? 0,'budgetCents'), currency:'USD', deadline,
    status:'new', clientId:null, clientNotes:text(input.clientNotes,'clientNotes',10000,true),
    createdAt:now(), updatedAt:now(), demo:mode==='demo', feeBps:/freelancer/i.test(input.source||'')?1000:settings.channelFeeBps, feeMinimumCents:/freelancer/i.test(input.source||'')?500:0, maxProductionSpendCents:0,
    analyses:{original:null,edited:null}, workflow:[], generations:[], revisions:[], outputs:[], timeline:[],
    paidCents:0, approvedAt:null, deliveryApprovedAt:null,
  };
}
export function emptyStudio(mode = 'live') {
  modeCheck(mode);
  return { version:1, mode, updatedAt:now(), revision:0, jobs:[], settings:defaultSettings(), clients:[], templates:studioTemplates(), audit:[], lessons:[],
    sources: [
      ['upwork','Upwork','https://www.upwork.com/nx/find-work/','manual','Paste a listing; account and approved integration are not verified.'],
      ['fiverr','Fiverr','https://www.fiverr.com/','unsupported','Seller marketplace: no public buyer-job feed connected.'],
      ['freelancer','Freelancer','https://www.freelancer.com/jobs/','manual','Paste a listing; API authorization is not connected.'],
      ['contra','Contra','https://contra.com/opportunities','manual','Paste a listing; account and payout setup are not verified.'],
    ].map(([id,name,url,status,detail]) => ({id,name,url,status,detail,lastCheckedAt:null,lastSuccessAt:null,nextCheckAt:null,listingCount:0,accountStatus:'unverified',paymentStatus:'not_verified'})),
  };
}
export function demoStudio() {
  const state = emptyStudio('demo');
  state.jobs = [
    {title:'Demo · Landing page rescue',source:'Demo marketplace brief',budgetCents:35000,rawBrief:'Build a responsive one-page website for a neighborhood bakery. We supply approved logo, copy, colors, and photos. Deliver HTML/CSS with a contact link and a README. No hosting purchase or payment integration.'},
    {title:'Demo · Customer interview synthesis',source:'Demo direct brief',budgetCents:18000,rawBrief:'Summarize supplied anonymized customer interviews into a cited findings report, theme table, and five evidence-backed recommendations. Do not invent quotations or customer facts.'},
  ].map((input,index) => ({...makeJob(input,'demo',state.settings),id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,createdAt:'2026-09-25T00:00:00.000Z',updatedAt:'2026-09-25T00:00:00.000Z'}));
  return state;
}
export function calculateEconomics(job, settings) {
  const estimatedSpendCents = job.workflow.reduce((n,s) => n + s.estimatedAttempts * s.unitCostCents,0);
  const actualSpendCents = job.generations.reduce((n,g) => n + (g.actualCostCents ?? 0),0);
  const channelFeeCents = Math.max(job.feeMinimumCents||0,Math.ceil(job.budgetCents * job.feeBps / 10000));
  const contingencyCents = Math.ceil(estimatedSpendCents * settings.contingencyBps / 10000);
  const expectedProfitCents = job.budgetCents - channelFeeCents - Math.max(estimatedSpendCents,actualSpendCents) - contingencyCents;
  return {clientPriceCents:job.budgetCents,channelFeeCents,estimatedSpendCents,actualSpendCents,contingencyCents,expectedProfitCents,
    marginBps:job.budgetCents ? Math.floor(expectedProfitCents/job.budgetCents*10000):0,
    withinBudget:Math.max(estimatedSpendCents,actualSpendCents)+contingencyCents <= job.maxProductionSpendCents};
}
export function studioMetrics(state) {
  const jobs = state.jobs.filter(j => j.demo === (state.mode==='demo'));
  return {jobs:jobs.length,active:jobs.filter(j=>!['rejected','delivered'].includes(j.status)).length,
    needsReview:jobs.filter(j=>j.status==='needs_review').length,delivered:jobs.filter(j=>j.status==='delivered').length,
    revenueCents:jobs.reduce((n,j)=>n+j.paidCents,0),spendCents:jobs.reduce((n,j)=>n+calculateEconomics(j,state.settings).actualSpendCents,0),
    pipelineCents:jobs.filter(j=>!['rejected','delivered'].includes(j.status)).reduce((n,j)=>n+j.budgetCents,0), demo:state.mode==='demo'};
}
export function audit(state, action, detail, job = null, actor = 'human') {
  const record={id:uid(),at:now(),jobId:job?.id || null,action,detail,actor};
  state.audit.push(record); if(job) {job.timeline.push(record); job.updatedAt=record.at;} return record;
}
export async function readStudio(mode='live') {
  modeCheck(mode);
  try {
    const state=JSON.parse(await fs.readFile(path.join(studioRoot(),mode==='live'?'state.json':'demo.json'),'utf8'));
    if(state.version!==1 || state.mode!==mode || !Array.isArray(state.jobs)) throw new Error('Studio store invalid; restore a valid backup.');
    if(!state.templates?.length)state.templates=studioTemplates();
    return normalizeStudioModels(state);
  } catch(error) { if(error.code==='ENOENT') return mode==='demo'?demoStudio():emptyStudio(mode); throw error; }
}
export async function mutateStudio(mode, mutate) {
  modeCheck(mode); const root=studioRoot(); await fs.mkdir(root,{recursive:true,mode:0o700});
  const lock=path.join(root,`${mode}.lock`); let handle;
  for(let attempt=0;attempt<100;attempt++) {
    try {handle=await fs.open(lock,'wx',0o600); await handle.writeFile(JSON.stringify({pid:process.pid,at:now()})); break;}
    catch(error) {if(error.code!=='EEXIST') throw error;
      // Only reclaim a dead owner's lock, never an active long-running transaction.
      try {const owner=JSON.parse(await fs.readFile(lock,'utf8')); try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH') await fs.unlink(lock);}}catch{}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  if(!handle) throw new Error('Studio is busy; try again.');
  const target=path.join(root,mode==='live'?'state.json':'demo.json'); const temp=`${target}.${uid()}.tmp`;
  try {const state=await readStudio(mode); const result=await mutate(state); state.updatedAt=now(); state.revision++;
    await fs.writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'}); await fs.rename(temp,target);
    return result ?? state;
  } finally {await fs.unlink(temp).catch(()=>{}); await handle.close(); await fs.unlink(lock);}
}
export function validateSettings(patch) {
  if(!patch || typeof patch!=='object' || Array.isArray(patch)) throw new Error('Invalid settings');
  const result={};
  for(const [key,value] of Object.entries(patch)) {
    if(['channelFeeBps','contingencyBps','targetMarginBps'].includes(key)) result[key]=integer(value,key,10000);
    else if(key==='maxAttemptsPerStep') {result[key]=integer(value,key,10); if(!value) throw new Error('At least one attempt required');}
    else if(['maxAutomaticSpendCents','maxRepairSpendCents'].includes(key)) {if(value!==0) throw new Error('Paid production is disabled'); result[key]=0;}
    else if(key==='allowedModels') {if(!Array.isArray(value)||!value.length||value.some(v=>!STUDIO_MODELS.includes(studioModel(v)))) throw new Error('Invalid allowedModels'); result[key]=[...new Set(value.map(studioModel))];}
    else if(key==='finalDeliveryRequiresApproval') {if(value!==true) throw new Error('Final delivery approval is required'); result[key]=true;}
    else if(['shareConceptsAutomatically','paidProvidersEnabled'].includes(key)) {if(value!==false) throw new Error('External automation is not connected'); result[key]=false;}
    else if(key==='automaticMessages') {if(!Array.isArray(value)||value.length) throw new Error('Automatic sending is not connected'); result[key]=[];}
    else throw new Error(`Unsupported setting: ${key}`);
  }
  return result;
}
export async function applyStudioAction(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid request');
  const mode=modeCheck(input.mode || 'live');
  return mutateStudio(mode,state=>{
    if(input.action==='create') {const job=makeJob(input,mode,state.settings);
      if(state.jobs.some(existing => (job.sourceId && existing.source===job.source && existing.sourceId===job.sourceId) || (job.sourceUrl && existing.sourceUrl===job.sourceUrl))) throw new Error('Listing is already in the pipeline');
      state.jobs.unshift(job); audit(state,'job.created','Brief added to the local pipeline.',job);}
    else if(input.action==='settings') {Object.assign(state.settings,validateSettings(input.settings));
      for(const job of state.jobs){if(job.approvedAt&&job.status!=='delivered'){job.approvedAt=null;delete job.approvalFingerprint;if(!job.generations.some(g=>['running','queued'].includes(g.status)))job.status='needs_review';}}
      audit(state,'settings.updated','Local operating settings updated; existing production approvals require review.');}
    else if(input.action==='edit_terms') {
      const job=state.jobs.find(j=>j.id===input.jobId);if(!job)throw new Error('Job not found');
      if(!['new','needs_review','rejected','approved'].includes(job.status)||job.generations.length)throw new Error('Terms cannot change after production starts');
      const validated=makeJob({...job,...input},mode,state.settings);
      for(const field of ['title','rawBrief','budgetCents','deadline','clientNotes'])job[field]=validated[field];
      if(input.feeBps!==undefined)job.feeBps=integer(input.feeBps,'feeBps',10000);
      if(input.feeMinimumCents!==undefined)job.feeMinimumCents=integer(input.feeMinimumCents,'feeMinimumCents');
      job.status='new';job.analyses={original:null,edited:null};job.workflow=[];job.approvedAt=null;job.deliveryApprovedAt=null;
      audit(state,'terms.edited','Agreed USD fixed price, deadline or brief updated. Prior analysis and approval invalidated; analyze again.',job);
    }
    else if(input.action==='reset_demo') {if(mode!=='demo') throw new Error('Only demo can be reset'); Object.assign(state,demoStudio()); audit(state,'demo.reset','Demo fixtures reset; real jobs are separate.');}
    else if(input.action==='reject') {const job=state.jobs.find(j=>j.id===input.jobId); if(!job) throw new Error('Job not found'); if(['generating','delivered'].includes(job.status)) throw new Error('Cannot reject this job state'); job.status='rejected'; audit(state,'job.rejected',text(input.reason || 'Rejected by operator','reason',2000),job);}
    else throw new Error('Unknown action');
    return state;
  });
}
