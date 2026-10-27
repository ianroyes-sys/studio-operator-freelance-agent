import {NextRequest,NextResponse} from 'next/server';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {studioAuthorized} from '@/lib/server/studioAuth';
import {resolveStudioOutput} from '@/scripts/studio-production.mjs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  if(!studioAuthorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
  const mode=req.nextUrl.searchParams.get('mode')||'live',jobId=req.nextUrl.searchParams.get('jobId')||'',outputId=req.nextUrl.searchParams.get('outputId')||'';
  if(!['live','demo'].includes(mode)||![jobId,outputId].every(x=>/^[a-f0-9-]{36}$/.test(x)))return NextResponse.json({error:'Invalid output identifiers'},{status:400});
  try{const output=await resolveStudioOutput(mode,jobId,outputId);if(!output)return NextResponse.json({error:'Output not found'},{status:404});
    const bytes=await fs.readFile(output.path);if(bytes.length!==output.byteLength||createHash('sha256').update(bytes).digest('hex')!==output.sha256)return NextResponse.json({error:'Output integrity changed; regenerate before download'},{status:409});
    return new NextResponse(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${output.name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Output unavailable'},{status:404});}
}
