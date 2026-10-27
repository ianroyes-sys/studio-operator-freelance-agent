import type {StudioState,StudioOutput,StudioModel} from '../lib/studio';
export const bundleSchema: Record<string,unknown>;
export function validateBundle(value: unknown): {files:{name:string;content:string}[];summary:string;limitations:string[]};
export function approveStudioJob(input: Record<string,unknown>): Promise<StudioState>;
export function startStudioProduction(input: Record<string,unknown>): Promise<StudioState>;
export function cancelStudioProduction(input: Record<string,unknown>): Promise<StudioState>;
export function recoverStudioRuns(mode: string): Promise<StudioState>;
export function resolveStudioOutput(mode: string,jobId: string,outputId: string): Promise<(StudioOutput & {path:string}) | null>;
export function testStudioConnection(model: StudioModel): Promise<{ready:boolean;model:StudioModel;paidApiSpendCents:number;checkedAt:string}>;
