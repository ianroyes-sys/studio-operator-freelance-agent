import type {StudioState} from '../lib/studio';
export function runStudioQA(input:Record<string,unknown>):Promise<StudioState>;
export function addStudioRevision(input:Record<string,unknown>):Promise<StudioState>;
export function approveStudioRevision(input:Record<string,unknown>):Promise<StudioState>;
export function rejectStudioRevision(input:Record<string,unknown>):Promise<StudioState>;
export function repairStudioOutput(input:Record<string,unknown>):Promise<StudioState>;
export function prepareStudioDelivery(input:Record<string,unknown>):Promise<StudioState>;
export function approveStudioDelivery(input:Record<string,unknown>):Promise<StudioState>;
export function recordStudioDelivery(input:Record<string,unknown>):Promise<StudioState>;
