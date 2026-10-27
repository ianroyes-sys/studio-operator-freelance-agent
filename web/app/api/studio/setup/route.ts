import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { workshopGuard } from '@/lib/server/workshop';
import { readStudioAccounts } from '@/lib/server/studioAccounts';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const denied=workshopGuard(req);if(denied)return denied;
 const accounts=await readStudioAccounts();
 let stripe:{configured:boolean;chargesEnabled?:boolean;payoutsEnabled?:boolean;mode?:string;error?:string}={configured:false};
 const key=process.env.STRIPE_SECRET_KEY;
 if(key){
  stripe={configured:true,mode:key.startsWith('sk_test_')?'test':'live_or_restricted'};
  try{const r=await fetch('https://api.stripe.com/v1/account',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(5000),cache:'no-store'});
    if(r.ok){const a=await r.json();stripe.chargesEnabled=!!a.charges_enabled;stripe.payoutsEnabled=!!a.payouts_enabled;}
    else stripe.error=`Stripe account check returned HTTP ${r.status}.`;
  }catch{stripe.error='Stripe account could not be reached.';}
 }
 const read=async(file:string)=>fs.readFile(path.join(process.cwd(),'docs/agency',file),'utf8').catch(()=> 'Service offer copy is not included in this repository.');
 return NextResponse.json({accounts,stripe,offersMarkdown:await read('service-offers.md'),readinessMarkdown:''},{headers:{'Cache-Control':'no-store'}});
}
