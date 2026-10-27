import type {StudioState,StudioClient} from '../lib/studio';
export function validateClientMemory(input:unknown):StudioClient;
export function saveStudioClient(input:Record<string,unknown>):Promise<StudioState>;
export function draftStudioMessage(input:Record<string,unknown>):Promise<StudioState>;
export function reviewStudioMessage(input:Record<string,unknown>):Promise<StudioState>;
export function createStudioTemplateJob(input:Record<string,unknown>):Promise<StudioState>;
export function addStudioLesson(input:Record<string,unknown>):Promise<StudioState>;
