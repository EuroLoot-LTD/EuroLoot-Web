import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,invite} from '../scripts/local-db.mjs';
import {localEnvironment} from '../scripts/local.mjs';
import {dispatch} from '../server/app.mjs';
import worker from '../server/worker.mjs';
import {euCountries} from '../server/policy.mjs';
import {policyVersion} from '../server/consent.mjs';
const accepted={version:policyVersion,terms:true,privacy:true,cookies:true,refunds:true};
const origin='https://staging.example';
const product='delivery-check';
const orderBody=(more={})=>({billingCountry:'IE',requestKey:crypto.randomUUID(),...more});
function setup(t){
  const db=openDatabase(':memory:',true);t.after(()=>db.sqlite.close());
  const env=localEnvironment(db);
  async function request(path,{cookie='',body,headers={},country='IE',local=true,raw}={}){
    const opts={headers:{cookie,...headers}};
    if(body!==undefined||raw!==undefined){opts.method='POST';opts.body=raw??JSON.stringify(body);opts.headers={origin,'content-type':'application/json',...opts.headers};}
    const r=await dispatch(new Request(origin+path,opts),env,{country,ip:'test',local});
    return r;
  }
  const call=async(...args)=>{const r=await request(...args);const data=await r.json();return {status:r.status,data};};
  async function login(id='buyer',role='customer'){
    const code=await invite(db,'fixture-'+id,role);
    const r=await request('/api/auth/verify',{body:{code,acceptance:accepted}});
    assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
  }
  async function add(cookie){assert.equal((await call('/api/basket',{cookie,body:{product,add:true}})).status,200);}
  return {db,env,request,call,login,add};
}
test('EU membership and edge origin policy cover assets and APIs',async t=>{
  const {env,request}=setup(t);assert.equal(euCountries.size,27);
  for(const country of ['GB','CH','NO','US','XX','T1','GP',null])assert.equal((await request('/retail/',{country})).status,403);
  for(const country of euCountries)assert.equal((await request('/api/catalog',{country})).status,200);
  const r=await worker.fetch(new Request(origin+'/api/catalog',{headers:{'CF-IPCountry':'IE'}}),env);assert.equal(r.status,403);
  assert.equal((await request('/healthz',{country:null})).status,200);
});
test('private records require sign-in, one-use invitations expire and sessions revoke',async t=>{
  const {db,request,login}=setup(t);for(const name of ['orders','library','tickets','admin/status','export'])assert.equal((await request('/api/'+name)).status,401);
  const code=await invite(db,'fixture-session');const p='/api/auth/verify';let r=await request(p,{body:{code,acceptance:accepted}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await request(p,{body:{code,acceptance:accepted}})).status,401);
  const cookie=await login();await request('/api/sessions/revoke',{cookie,body:{}});assert.equal((await request('/api/orders',{cookie})).status,401);
  const old=await invite(db,'fixture-expired');db.sqlite.exec('UPDATE invitations SET expires=0');assert.equal((await request(p,{body:{code:old,acceptance:accepted}})).status,401);
});
test('input size, same-origin writes, content type and lack of provider configuration',async t=>{
  const {request}=setup(t);
  assert.equal((await request('/api/tickets',{body:{},headers:{origin:'https://external.test'}})).status,403);
  assert.equal((await request('/api/tickets',{body:{},headers:{'content-type':'text/plain'}})).status,415);
  assert.equal((await request('/api/tickets',{raw:'['})).status,400);
  assert.equal((await request('/api/tickets',{raw:'x'.repeat(12500)})).status,413);
  assert.equal((await request('/api/auth/request',{local:false,body:{email:'example@example.test',country:'IE',acceptance:accepted}})).status,503);
});
test('ownership, atomic basket snapshot, coupon, idempotent replay and immediate refund revocation',async t=>{
  const {db,request,call,login,add}=setup(t);const cookie=await login(),other=await login('second'),admin=await login('staff','admin');
  await add(cookie);await call('/api/wishlist',{cookie,body:{product,add:true}});
  const body=orderBody({coupon:'TEST25',total:1,owner:'fixture-second',role:'admin'});
  const parts=await Promise.all([call('/api/checkout',{cookie,body}),call('/api/checkout',{cookie,body})]);const order=parts[0].data;
  assert.equal(parts[1].data.id,order.id);assert.equal(order.total,300);assert.equal(order.discount,100);
  assert.equal((await call('/api/library',{cookie})).data.items.length,1);
  assert.equal((await call('/api/library',{cookie:other})).data.items.length,0);
  assert.equal((await call('/api/basket',{cookie})).data.items.length,0);
  assert.equal((await call('/api/checkout',{cookie,body:{...body,coupon:''}})).status,409);
  assert.equal((await call('/api/admin/status',{cookie})).status,403);
  const release=(await call('/api/download',{cookie,body:{product,version:'1.0.0'}})).data;
  assert.equal((await request(release.url,{cookie:other})).status,403);
  const bytes=Buffer.from(await (await request(release.url,{cookie})).arrayBuffer());assert.equal(bytes.length,119);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),release.sha256);
  const range=await request(release.url,{cookie,headers:{range:'bytes=10-19'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(10,20));
  assert.equal((await request(release.url,{cookie,headers:{range:'bytes=9000-'}})).status,416);
  assert.equal((await call('/api/admin/refund',{cookie:admin,body:{id:order.id}})).status,200);
  assert.equal((await request(release.url,{cookie})).status,403);assert.equal((await call('/api/library',{cookie})).data.items.length,0);
  assert.equal((await call('/api/export',{cookie})).data.orders[0].state,'refunded');
  assert.throws(()=>db.sqlite.exec('UPDATE audit SET target=action'),/append-only/);
});
test('checkout rejects incorrect region, expired promotion, empty basket and unavailable items with no partial order',async t=>{
  const {db,call,login,add}=setup(t);const cookie=await login();
  const buy=more=>call('/api/checkout',{cookie,body:orderBody(more)});
  assert.equal((await buy({})).status,409);await add(cookie);
  assert.equal((await buy({billingCountry:'US'})).status,403);assert.equal((await buy({coupon:'INVALID'})).status,409);
  db.sqlite.exec("UPDATE promotions SET ends=10");assert.equal((await buy({coupon:'TEST25'})).status,409);
  db.sqlite.exec("UPDATE products SET countries='[\"DE\"]'");assert.equal((await buy({})).status,409);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM orders').get().n,0);
  assert.equal((await call('/api/catalog')).data.items.length,0);
});
test('refunded coupons respect per-account limits and fixed discounts cannot make prices negative',async t=>{
  const {db,call,login,add}=setup(t);const cookie=await login(),admin=await login('staff','admin');
  db.sqlite.exec("INSERT INTO promotions VALUES('FIXED',0,900,0,2147483647,2,1)");await add(cookie);
  const order=(await call('/api/checkout',{cookie,body:orderBody({coupon:'FIXED'})})).data;assert.equal(order.total,0);
  await call('/api/admin/refund',{cookie:admin,body:{id:order.id}});await add(cookie);
  assert.equal((await call('/api/checkout',{cookie,body:orderBody({coupon:'FIXED'})})).status,409);
});
test('support and submission review enforce per-owner reads, distinct privileges and verified sessions',async t=>{
  const {db,call,login}=setup(t);const cookie=await login(),other=await login('other'),staff=await login('support','support'),admin=await login('staff','admin');
  const ticket=await call('/api/tickets',{cookie,body:{subject:'Download question',details:'My authorised fixture file.',category:'Download'}});assert.equal(ticket.status,201);
  const sub=await call('/api/submissions',{cookie,body:{studio:'Example Studio',title:'Private draft',details:'For internal review only.'}});assert.equal(sub.status,201);
  assert.equal((await call('/api/tickets',{cookie:other})).data.items.length,0);assert.equal((await call('/api/submissions',{cookie:other})).data.items.length,0);
  assert.equal((await call('/api/admin/submissions',{cookie:staff})).status,403);
  assert.equal((await call('/api/admin/tickets',{cookie:staff,body:{id:ticket.data.id,state:'closed'}})).status,200);
  assert.equal((await call('/api/admin/submissions',{cookie:admin,body:{id:sub.data.id,state:'approved'}})).status,200);
  assert.equal((await call('/api/submissions',{cookie})).data.items[0].state,'approved');
  assert.equal((await call('/api/catalog')).data.items.length,1);
  db.sqlite.exec("UPDATE sessions SET strong=0 WHERE owner='fixture-staff'");assert.equal((await call('/api/admin/status',{cookie:admin})).status,403);
});
test('public deployment ignores local invitations, hides fixtures, and enforces auth rate limits',async t=>{
  const {env,request,db,call}=setup(t);env.SANDBOX='0';assert.equal((await call('/api/catalog')).data.items.length,0);
  const token=await invite(db,'fixture-local');assert.equal((await request('/api/auth/verify',{local:false,body:{code:token,email:'a@example.test',acceptance:accepted}})).status,400);
  for(let i=0;i<18;i++)await request('/api/auth/verify',{body:{code:'a'.repeat(48),acceptance:accepted}});
  assert.equal((await request('/api/auth/verify',{body:{code:'a'.repeat(48),acceptance:accepted}})).status,429);
});
test('Stripe test notifications validate signatures, currency, amount and billing country; fulfil only once',async t=>{
  const {db,env,request,login,add}=setup(t);env.STRIPE_TEST_KEY='sk_test_fixture';env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
  const cookie=await login();await add(cookie);const id=crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO orders(id,owner,request_key,country,mode) VALUES(?,'fixture-buyer',?,'IE','stripe-test')").run(id,crypto.randomUUID());
  const obj={client_reference_id:id,metadata:{order_id:id},currency:'eur',amount_total:400,payment_status:'paid',customer_details:{address:{country:'IE'}},payment_intent:'pi_fixture'};
  async function event(object,opt={}){
    const raw=JSON.stringify({livemode:opt.live||false,type:opt.type||'checkout.session.completed',data:{object}});
    const ts=Math.floor(Date.now()/1000)+(opt.time||0);const sig=createHmac('sha256',opt.secret||'whsec_fixture').update(ts+'.'+raw).digest('hex');
    return request('/webhooks/stripe',{country:'US',raw,headers:{'stripe-signature':'t='+ts+',v1='+sig}});
  }
  assert.equal((await event(obj,{secret:'wrong'})).status,400);assert.equal((await event(obj,{time:-450})).status,400);assert.equal((await event(obj,{live:true})).status,400);
  assert.equal((await event({...obj,amount_total:1})).status,400);assert.equal((await event({...obj,customer_details:{address:{country:'GB'}}})).status,409);
  assert.equal((await event(obj)).status,200);assert.equal((await event(obj)).status,200);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM grants').get().n,1);
  assert.equal((await event({payment_intent:'pi_fixture',refunded:true,amount_refunded:400,currency:'eur'},{type:'charge.refunded'})).status,200);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM grants').get().n,0);
});
test('local database reopens and a consistent SQLite backup restores',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'euroloot-db-'));try{
    const a=openDatabase(join(dir,'main.sqlite'),true);await invite(a,'fixture-backup');a.sqlite.prepare('VACUUM INTO ?').run(join(dir,'backup.sqlite'));a.sqlite.close();
    const b=openDatabase(join(dir,'backup.sqlite'));assert.equal(b.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(b.sqlite.prepare('SELECT count(*) n FROM accounts').get().n,1);b.sqlite.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('admin promotion schedules, region limits, duplicate codes and receipt ownership',async t=>{
  const {login,call,add}=setup(t);const cookie=await login(),other=await login('other'),admin=await login('operator','admin');
  const body={code:'FRONLY',percent:0,fixed:100,starts:0,ends:2147483647,maxUses:4,perAccount:1,countries:['FR'],exclusions:[]};
  assert.equal((await call('/api/admin/promotions',{cookie,body})).status,403);
  assert.equal((await call('/api/admin/promotions',{cookie:admin,body})).status,201);
  assert.equal((await call('/api/admin/promotions',{cookie:admin,body})).status,409);
  await add(cookie);assert.equal((await call('/api/checkout',{cookie,body:orderBody({coupon:'FRONLY'})})).status,409);
  const order=(await call('/api/checkout',{cookie,body:orderBody()})).data;
  assert.equal((await call('/api/order?id='+order.id,{cookie})).data.lines[0].cents,400);
  assert.equal((await call('/api/order?id='+order.id,{cookie:other})).status,404);
});
test('all four current documents are required on every login and registration entry point',async t=>{
  const {db,call,request}=setup(t);const code=await invite(db,'fixture-consent');
  for(const [i,method] of ['request','verify','exchange','oauth'].entries()){
    for(const bad of [null,{...accepted,terms:false},{...accepted,privacy:i},{...accepted,cookies:'true'},{...accepted,refunds:false},{...accepted,version:'old'}]){
      db.sqlite.exec('DELETE FROM rate_windows');
      assert.equal((await call('/api/auth/'+method,{body:{code,email:'fixture@example.test',acceptance:bad}})).status,422);
    }
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0);
  const ok=await request('/api/auth/verify',{body:{code,acceptance:accepted}});assert.equal(ok.status,200);
  const cookie=ok.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(JSON.parse((await call('/api/export',{cookie})).data.acceptances[0].documents),['terms','privacy','cookies','refunds']);
  db.sqlite.exec("UPDATE sessions SET policy_version='obsolete'");assert.equal((await request('/api/orders',{cookie})).status,401);
});
test('email registration and sign-in with a verified provider response; OAuth PKCE round-trip and replay rejection',async t=>{
  const {env,db,request}=setup(t);
  env.AUTH_ORIGIN='https://fixture.supabase.co';env.AUTH_PUBLISHABLE_KEY='fixture-key';env.OAUTH_PROVIDERS='google,github,discord';
  const id=crypto.randomUUID(),claims={sub:id,exp:Math.floor(Date.now()/1000)+600,aal:'aal1'};
  const token='fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.test',seen=[];
  t.mock.method(globalThis,'fetch',async(raw,opts)=>{
    const u=new URL(raw);assert.equal(u.origin,env.AUTH_ORIGIN);seen.push([u.pathname,opts.body?JSON.parse(opts.body):null]);
    if(u.pathname.endsWith('/otp'))return Response.json({});
    if(u.pathname.endsWith('/verify')||u.pathname.endsWith('/token'))return Response.json({access_token:token});
    if(u.pathname.endsWith('/user')){assert.equal(opts.headers.Authorization,'Bearer '+token);return Response.json({id,email_confirmed_at:'2026-11-20'});}
    throw Error('Unexpected identity route');
  });
  const body={country:'IE',email:'fixture@example.test',acceptance:accepted};
  assert.equal((await request('/api/auth/request',{local:false,body})).status,200);
  const signed=await request('/api/auth/verify',{local:false,body:{...body,code:'123456'}});
  assert.equal(signed.status,200);assert.match(signed.headers.get('set-cookie'),/^__Host-el=.*Secure/);
  for(const provider of ['google','github','discord']){
    const begin=await request('/api/auth/oauth',{local:false,body:{...body,provider}});
    const cookie=begin.headers.get('set-cookie').split(';')[0];const url=new URL((await begin.json()).url);
    assert.equal(url.searchParams.get('provider'),provider);assert.equal(url.searchParams.get('redirect_to'),origin+'/auth/callback');
    const route='/auth/callback?code=example-authorisation';assert.equal((await request(route,{local:false})).status,401);
    const response=await request(route,{local:false,cookie});assert.equal(response.status,303);
    const exchange=seen.findLast(row=>row[0].endsWith('/token'))[1];
    assert.equal(createHash('sha256').update(exchange.code_verifier).digest('base64url'),url.searchParams.get('code_challenge'));
    assert.equal((await request(route,{local:false,cookie})).status,401);
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM policy_acceptances').get().n,4);
});
