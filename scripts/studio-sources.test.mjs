import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeProject,mergeListings,refreshSources,readSources,shortlistListing,DISCOVERY_QUERIES} from './studio-sources.mjs';
test('discovery preserves first observation and shortlist across duplicate refreshes',()=>{
  const a=normalizeProject({id:1,title:'CSV cleanup',time_submitted:1700000000,budget:{minimum:50,maximum:100},currency:{code:'USD'}},'2026-01-01T00:00:00Z');
  const b={...a,firstSeenAt:'2026-01-02T00:00:00Z',lastSeenAt:'2026-01-02T00:00:00Z'};
  const rows=mergeListings([{...a,shortlisted:true}],[b,b]);
  assert.equal(rows.length,1);assert.equal(rows[0].firstSeenAt,a.firstSeenAt);assert.equal(rows[0].shortlisted,true);
});
test('source money is not silently converted and non-automatable scope is flagged',()=>{
  const p=normalizeProject({id:2,title:'Website photos on-site filming',currency:{code:'INR'},budget:{minimum:1000,maximum:2000}});
  assert.equal(p.suitable,false);assert.equal(p.currency,'INR');assert.equal(p.budgetMax,2000);assert.match(p.actionBlocker,/\$20/);
  assert.equal(normalizeProject({title:'bad'}),null);
  const restricted=normalizeProject({id:4,title:'Landing page',preview_description:'Website work',description:'No AI. Human only.'});assert.equal(restricted.suitable,false);assert.equal(restricted.budgetType,'unknown');
  const long=normalizeProject({id:5,title:'Website',description:'a'.repeat(30001)});assert.equal(long.descriptionIncomplete,true);assert.equal(long.descriptionOriginalLength,30001);assert.equal(long.suitable,false);
  const preview=normalizeProject({id:6,title:'Website',preview_description:'Only a preview'});assert.equal(preview.descriptionIncomplete,true);
  assert.equal(normalizeProject({id:7,title:'Website',description:'Build a HIPAA-compliant laboratory system.'}).suitable,false);
});
test('failed refresh retains data, backs off and never becomes live',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-sources-test-'));process.env.STUDIO_DATA_DIR=dir;
  try {
    let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({status:'success',result:{projects:[{id:3,title:'Landing page'}]}})};};
    const first=await refreshSources({fetchImpl,now:new Date('2026-01-01T00:00:00Z')});assert.equal(first.listings.length,1);assert.equal(calls,DISCOVERY_QUERIES.length);
    shortlistListing('freelancer:3',true);
    const throttled=await refreshSources({fetchImpl,now:new Date('2026-01-01T00:01:00Z')});assert.equal(throttled.throttled,true);assert.equal(calls,DISCOVERY_QUERIES.length);
    const fail=await refreshSources({fetchImpl:async()=>({ok:false,status:429}),now:new Date('2026-01-01T00:06:00Z')});
    assert.equal(fail.sources[0].status,'error');assert.equal(fail.listings.length,1);assert.equal(fail.listings[0].shortlisted,true);assert.equal(fail.sources[0].lastSuccessAt,first.updatedAt);assert.match(fail.sources[0].error,/429/);
    assert.equal(readSources().sources[0].nextRefreshAt,'2026-01-01T00:16:00.000Z');
    const limited=await refreshSources({fetchImpl:async()=>({ok:false,status:429,headers:new Headers({'retry-after':'7200'})}),now:new Date('2026-01-01T00:17:00Z')});
    assert.equal(limited.sources[0].nextRefreshAt,'2026-01-01T02:17:00.000Z');
  } finally {delete process.env.STUDIO_DATA_DIR;fs.rmSync(dir,{recursive:true,force:true});}
});
