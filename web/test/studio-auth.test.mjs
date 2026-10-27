import test from 'node:test';
import assert from 'node:assert/strict';
import {studioMutationOrigin} from '../lib/server/studioAuth.ts';
const request=(origin,host='127.0.0.1:4782',key=null)=>({headers:new Headers({...origin?{origin}:{},host,...key?{'x-studio-key':key}:{}}),nextUrl:new URL('http://localhost:4782/api/studio')});
test('studio mutation origin permits actual loopback host and rejects foreign origins',()=>{
 assert.equal(studioMutationOrigin(request('http://127.0.0.1:4782')),true);
 assert.equal(studioMutationOrigin(request('http://localhost:4782')),true);
 assert.equal(studioMutationOrigin(request('https://attacker.example')),false);
 assert.equal(studioMutationOrigin(request('http://localhost:4782/foreign')),false);
 assert.equal(studioMutationOrigin(request(null)),false);
 assert.equal(studioMutationOrigin(request(null,undefined,'separate-auth-check-required')),true);
});
