import { NextRequest, NextResponse } from 'next/server';
export function workshopGuard(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_MODE === 'snapshot') return NextResponse.json({ error: 'Workshop runs on your Mac.' }, { status: 503 });
  const key = process.env.STUDIO_KEY;
  if (!key || (req.cookies.get('studio_key')?.value !== key && req.headers.get('x-studio-key') !== key)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const origin = req.headers.get('origin');
  if (req.method !== 'GET' && origin && origin !== req.nextUrl.origin && origin !== `${req.nextUrl.protocol}//${req.headers.get('host')}`) return NextResponse.json({ error: 'cross-origin' }, { status: 403 });
  return null;
}
