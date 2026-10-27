export interface LeadFunnel { hot:number; ready:number; sent:number; won:number; lost:number; sentThisWeek:number; wonThisWeek:number; wonValueUsd:number; winRate:number|null; draftsToday:number; lastReceipt:{at:string;outcome:string}|null }
export interface StudioLead { id:string; title:string; url:string; status:string; score:number; tier:string; finalPriceUsd?:number; jobId?:string; proposal?:{bidUsd:number|null;coverLetter:string;deliveryDays:number}; [key:string]:unknown }
export interface LeadState { version:number; updatedAt:string|null; leads:Record<string,StudioLead>; daily:{date:string|null;drafts:number}; receipts:{at:string;id:string;outcome:string}[] }
export function readLeads():LeadState;
export function leadFunnel(state:LeadState,now?:number):LeadFunnel;
export function listLeads(options?:{includeClosed?:boolean},now?:number):{updatedAt:string|null;funnel:LeadFunnel;leads:StudioLead[]};
export function updateLead(input:{id:string;action:string;priceUsd?:number;reason?:string;by?:string;extra?:Record<string,unknown>|null}):Promise<StudioLead>;
export function recordLeadVet(id:string,vet:Record<string,unknown>):Promise<StudioLead>;
export function redraftLead(id:string):Promise<StudioLead>;
export function convertWonLead(id:string,options?:{mode?:'live'|'demo'}):Promise<{jobId:string;existing:boolean}>;
export function runLeadPipeline(options?:Record<string,unknown>):Promise<{drafted:{id:string;ok:boolean;worthBidding:boolean|null;error:string|null}[]}>;
export function autopilotWonJob(jobId:string,options?:{mode?:'live'|'demo'}):Promise<{autopilot:boolean;reason?:string}>;
