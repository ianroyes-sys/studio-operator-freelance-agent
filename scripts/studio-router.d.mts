import type {StudioCatalogModel,StudioJob,StudioSettings,StudioState} from '../lib/studio';
export function studioCatalog(): Promise<StudioCatalogModel[]>;
export function approvalFingerprint(job:StudioJob,settings:StudioSettings):string;
export function assertApproval(job:StudioJob,settings:StudioSettings):void;
export function overrideStudioRoute(input:Record<string,unknown>):Promise<StudioState>;
