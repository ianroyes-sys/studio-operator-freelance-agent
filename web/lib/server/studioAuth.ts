import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
function equal(a: string, b: string) { const aa=Buffer.from(a), bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb); }
export function studioAuthorized(req: NextRequest) {
  const key=process.env.STUDIO_KEY;
  if(!key || process.env.NEXT_PUBLIC_MODE==='snapshot') return false;
  return [req.cookies.get('studio_key')?.value,req.headers.get('x-studio-key')].some(value=>typeof value==='string' && equal(value,key));
}
export function studioMutationOrigin(req: NextRequest) {
  const origin=req.headers.get('origin');
  if(!origin) return !!req.headers.get('x-studio-key');
  try {
    const parsed=new URL(origin);
    if(parsed.origin!==origin)return false;
    // Next normalizes its internal URL to localhost in local development.
    // Compare the browser origin to the actual Host too, never a forwarded host.
    return parsed.origin===req.nextUrl.origin || parsed.origin===`${req.nextUrl.protocol}//${req.headers.get('host')}`;
  } catch {return false;}
}
