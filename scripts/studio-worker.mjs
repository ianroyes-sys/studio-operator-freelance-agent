import {executeStudioGeneration} from './studio-production.mjs';
const [mode,jobId,generationId]=process.argv.slice(2);
if(!['live','demo'].includes(mode)||![jobId,generationId].every(id=>/^[a-f0-9-]{36}$/.test(id||'')))throw new Error('Invalid worker identifiers');
const controller=new AbortController();
process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
await executeStudioGeneration(mode,jobId,generationId,controller.signal);
