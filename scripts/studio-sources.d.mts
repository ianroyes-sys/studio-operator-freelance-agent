export interface StudioListing { id:string; source:string; title:string; description:string; descriptionIncomplete?:boolean; descriptionOriginalLength?:number; url:string; publishedAt:string|null; firstSeenAt:string; lastSeenAt:string; currency:string; budgetMin:number|null; budgetMax:number|null; budgetType:string; skills:string[]; suitable:boolean; fitReasons:string[]; actionBlocker:string; availability:string; shortlisted:boolean }
export interface StudioSource { id:string; name:string; mode:string; status:string; url:string; note:string; lastAttemptAt:string|null; lastSuccessAt:string|null; nextRefreshAt:string|null; error:string|null }
export interface SourceState { version:number; pollSeconds:number; updatedAt:string|null; sources:StudioSource[]; listings:StudioListing[]; receipts:unknown[]; refreshing?:boolean; throttled?:boolean }
export function readSources():SourceState;
export function refreshSources(options?:{fetchImpl?:typeof fetch;now?:Date}):Promise<SourceState>;
export function shortlistListing(id:string,value:boolean):SourceState;
