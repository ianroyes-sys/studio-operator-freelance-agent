export type StudioMode = "live" | "demo";
export type StudioStatus = "new" | "needs_review" | "approved" | "generating" | "qa" | "delivered" | "rejected";
export type StudioModel = "opus" | "sonnet";
export interface BriefAnalysis {
  jobType: string; conciseSummary: string;
  deliverables: { name: string; format: string; aspectRatio: string; duration: number; resolution: string; exactText: string }[];
  suppliedAssets: string[]; missingAssets: string[]; questionsForClient: string[]; brandConstraints: string[];
  rightsAndConsentFlags: string[]; technicalRisks: string[]; revisionRisk: "low" | "medium" | "high";
  confidence: number; decision: "accept" | "human_review" | "reject"; decisionReasons: string[];
  proposedWorkflow: { capability: string; purpose: string }[]; estimatedAttemptsByStep: number[]; assumptions: string[];
}
export interface StudioStep {
  id: string; title: string; role: "search" | "control" | "ship" | "finish"; model: StudioModel;
  purpose: string; inputs: string[]; expectedOutputs: string[]; estimatedAttempts: number; unitCostCents: number;
  maxAttempts: number; maxSpendCents: number; status: "pending" | "approved" | "running" | "completed" | "failed";
  rationale: string; failureMode: string; alternative: StudioModel;
}
export interface StudioGeneration {
  // Historical generations keep the model that actually ran (legacy runs may name gpt-6-* ids).
  id: string; stepId: string; model: StudioModel | (string & {}); providerRequestId: string | null;
  status: "queued" | "running" | "completed" | "failed" | "canceled" | "timed_out";
  estimatedCostCents: number; actualCostCents: number | null; outputIds: string[]; error: string | null;
  createdAt: string; completedAt: string | null;
  workerPid?: number; workerStartedAt?: string;
  modelPid?: number; modelRunToken?: string;
  workflowRunId?: string;
}
export interface StudioOutput { id: string; name: string; mimeType: string; path: string; generationId: string; createdAt: string; demo: boolean; supersededBy?: string;sha256:string;byteLength:number }
export interface StudioRevision { id: string; note: string; deliverable: string; recommendedAction: string; incrementalCostCents: number; approval: "pending" | "approved" | "rejected"; createdAt: string;rejectionReason?:string }
export interface StudioQA {id:string;createdAt:string;outputIds:string[];outputHashes?:Record<string,string>;generationId:string|null;approvalFingerprint:string;checks:{requirement:string;status:"pass"|"fail"|"human_review"|"not_applicable";evidence:string}[];verdict:"ready_for_review"|"repair"|"blocked";repairReason:string;model:string;limitations:string[]}
export type StudioDraftKind="intake"|"proposal"|"progress"|"concepts"|"revision"|"change_order"|"delivery"|"follow_up";
export interface StudioMessageDraft {id:string;kind:StudioDraftKind;body:string;createdAt:string;reviewedAt:string|null;status:"draft"|"reviewed";model:string}
export interface StudioLesson {id:string;jobId:string;createdAt:string;lesson:string;evidence:string}
export interface StudioAudit { id: string; at: string; jobId: string | null; action: string; detail: string; actor: "human" | "operator" | "system" }
export interface StudioJob {
  id: string; title: string; source: string; sourceUrl: string; sourceId: string; rawBrief: string; budgetCents: number;
  currency: "USD"; deadline: string | null; status: StudioStatus; clientId: string | null; clientNotes: string;
  createdAt: string; updatedAt: string; demo: boolean; feeBps: number; maxProductionSpendCents: number;
  feeMinimumCents?: number;
  analyses: { original: BriefAnalysis | null; edited: BriefAnalysis | null }; workflow: StudioStep[];
  generations: StudioGeneration[]; revisions: StudioRevision[]; outputs: StudioOutput[]; timeline: StudioAudit[];
  paidCents: number; approvedAt: string | null; deliveryApprovedAt: string | null;
  approvalFingerprint?: string;
  workflowRun?: {id:string;status:'running'|'paused'|'stopped'|'completed';approvalFingerprint:string;startedAt:string;lastGenerationId:string|null;endedAt?:string;reason?:string};
  qa?: StudioQA[]; deliveryNote?: string; deliveryPreparedAt?: string; deliveryRecordedAt?: string;
  deliveryPackageFingerprint?: string;
  messages?: StudioMessageDraft[]; templateId?: string;
  clientMemorySnapshot?: StudioClient;
}
export interface StudioSettings {
  channelFeeBps: number; contingencyBps: number; targetMarginBps: number; maxAutomaticSpendCents: number;
  maxRepairSpendCents: number; maxAttemptsPerStep: number; allowedModels: StudioModel[];
  automaticMessages: string[]; shareConceptsAutomatically: boolean; finalDeliveryRequiresApproval: boolean;
  pauseConditions: string[]; paidProvidersEnabled: boolean;
}
export interface StudioSource {
  id: string; name: string; url: string; status: "not_connected" | "manual" | "connected" | "error" | "unsupported";
  lastCheckedAt: string | null; lastSuccessAt: string | null; nextCheckAt: string | null; detail: string;
  listingCount: number; accountStatus: string; paymentStatus: string;
}
export interface StudioClient {
  id: string; name: string; logos: string[]; colors: string[]; fonts: string[]; tone: string;
  productDetails: string; winningAssets: string[]; rejectedStyles: string[]; deliveryPreferences: string; communicationPreferences: string;
}
export interface StudioTemplate {
  id: string; name: string; description: string; requiredInputs: string[]; acceptedFileTypes: string[];
  recipe: string[]; qualityChecklist: string[]; includedRevisions: number; deliveryPackage: string[];
  targetMarginBps: number; maxProductionSpendCents: number; escalationConditions: string[];
}
export interface StudioState {
  version: 1; mode: StudioMode; updatedAt: string; revision: number; jobs: StudioJob[]; settings: StudioSettings;
  sources: StudioSource[]; clients: StudioClient[]; templates: StudioTemplate[]; audit: StudioAudit[];
  lessons?: StudioLesson[];
}
export interface StudioMetrics { jobs: number; active: number; needsReview: number; delivered: number; revenueCents: number; spendCents: number; pipelineCents: number; demo: boolean }
export interface StudioEconomics { clientPriceCents: number; channelFeeCents: number; estimatedSpendCents: number; actualSpendCents: number; contingencyCents: number; expectedProfitCents: number; marginBps: number; withinBudget: boolean }
export interface StudioCatalogModel { id: StudioModel; available: boolean; provider: string; incrementalCostCents: number; roles: string[]; capabilities: string[]; strengths: string; failureMode: string; limitation: string }
export interface StudioResponse { state: StudioState; metrics: StudioMetrics; catalog?: StudioCatalogModel[] }
export const STUDIO_STATUSES: StudioStatus[] = ["new", "needs_review", "approved", "generating", "qa", "delivered", "rejected"];
export function studioEconomics(job: StudioJob, settings: StudioSettings): StudioEconomics {
  const estimatedSpendCents=job.workflow.reduce((sum,step)=>sum+step.estimatedAttempts*step.unitCostCents,0);
  const actualSpendCents=job.generations.reduce((sum,generation)=>sum+(generation.actualCostCents ?? 0),0);
  const channelFeeCents=Math.max(job.feeMinimumCents||0,Math.ceil(job.budgetCents*job.feeBps/10000));
  const contingencyCents=Math.ceil(estimatedSpendCents*settings.contingencyBps/10000);
  const expectedProfitCents=job.budgetCents-channelFeeCents-Math.max(estimatedSpendCents,actualSpendCents)-contingencyCents;
  return {clientPriceCents:job.budgetCents,estimatedSpendCents,actualSpendCents,channelFeeCents,contingencyCents,expectedProfitCents,
    marginBps:job.budgetCents?Math.floor(expectedProfitCents/job.budgetCents*10000):0,
    withinBudget:Math.max(estimatedSpendCents,actualSpendCents)+contingencyCents<=job.maxProductionSpendCents};
}
