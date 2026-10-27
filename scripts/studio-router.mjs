import {createHash} from 'node:crypto';
import {availableStudioModels} from './studio-analysis.mjs';
import {mutateStudio,audit,integer,STUDIO_MODELS,legacyStudioModel} from './studio-store.mjs';
export async function studioCatalog(){const available=await availableStudioModels();return STUDIO_MODELS.map(id=>({id,available:available.includes(id),provider:'Local Claude Code (MAX subscription)',incrementalCostCents:0,
  roles:['search','control','ship','finish'],capabilities:['text','code','data','qa'],
  strengths:id==='opus'?'Brief interpretation, planning, implementation, client copy and review.':'Faster drafting and structured digital deliverables.',
  failureMode:'Can omit constraints or invent facts. Code must be tested separately; generated QA is advisory.',
  limitation:available.includes(id)?'Existing subscription and human labor excluded from incremental costs. No paid API or media generation.':'Local Claude Code CLI not found; unavailable for execution.'}));}
export function approvalFingerprint(job,settings){return createHash('sha256').update(JSON.stringify({brief:job.rawBrief,price:job.budgetCents,fee:job.feeBps,feeMinimum:job.feeMinimumCents||0,deadline:job.deadline,clientNotes:job.clientNotes,analysis:job.analyses.edited,
  workflow:job.workflow.map(({status,...step})=>step),maxSpend:job.maxProductionSpendCents,clientMemory:job.clientMemorySnapshot||null,settings})).digest('hex');}
// Plans approved before the Claude migration were fingerprinted with legacy model ids; the read-time
// mapping is reversible, so the same approved plan still verifies without re-approval.
function legacyView(job,settings){return {job:{...job,workflow:job.workflow.map(s=>({...s,model:legacyStudioModel(s.model),...(s.alternative?{alternative:legacyStudioModel(s.alternative)}:{})}))},settings:{...settings,allowedModels:settings.allowedModels.map(legacyStudioModel)}};}
export function assertApproval(job,settings){const legacy=legacyView(job,settings);if(!job.approvedAt||(job.approvalFingerprint!==approvalFingerprint(job,settings)&&job.approvalFingerprint!==approvalFingerprint(legacy.job,legacy.settings)))throw new Error('Brief, workflow or settings changed; review and approve the current plan');}
export async function overrideStudioRoute(input){const available=await availableStudioModels();return mutateStudio(input.mode||'live',state=>{const job=state.jobs.find(j=>j.id===input.jobId);if(!job)throw new Error('Job not found');
  if(job.status==='delivered'||job.generations.some(g=>['running','queued'].includes(g.status)))throw new Error('Cannot change this workflow while running or delivered');
  const step=job.workflow.find(s=>s.id===input.stepId);if(!step)throw new Error('Workflow step not found');
  if(!available.includes(input.model)||!state.settings.allowedModels.includes(input.model))throw new Error('Model is unavailable or not allowed');
  if(step.status==='completed')throw new Error('Completed steps are immutable; use a revision');
  const attempts=integer(input.estimatedAttempts??step.estimatedAttempts,'estimatedAttempts',state.settings.maxAttemptsPerStep);if(!attempts)throw new Error('At least one attempt is required');
  const role=input.role||step.role;if(!['search','control','ship','finish'].includes(role))throw new Error('Invalid production role');
  step.model=input.model;step.estimatedAttempts=attempts;step.maxAttempts=state.settings.maxAttemptsPerStep;step.role=role;step.status='pending';
  step.rationale=`Human selected ${input.model} for ${role}. Local Claude Code CLI verified; incremental API cost is zero.`;
  job.status='needs_review';job.approvedAt=null;delete job.approvalFingerprint;
  audit(state,'route.overridden',`${step.title}: ${input.model}, ${attempts} estimated attempts, ${role}; new approval required.`,job);return state;
});}
