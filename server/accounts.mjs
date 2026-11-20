import {first,run,json,field,requireValue,randomToken,digest,supportedCountry} from './policy.mjs';
import {policies,policyVersion,requireAcceptance} from './consent.mjs';
const clock=()=>Math.floor(Date.now()/1000);
const cookieName=local=>local?'el_local':'__Host-el';
function sessionCookie(key,value,ttl,local) {
  return key+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+ttl+(local?'':'; Secure');
}
export async function limit(db,key,maximum,seconds) {
  const window=Math.floor(clock()/seconds);
  const row=await first(db,'INSERT INTO rate_windows VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',key+':'+window,(window+1)*seconds);
  requireValue(row.hits<=maximum,429,'Too many requests. Try again later.');
}
export async function current(request,env,local) {
  const name=cookieName(local)+'=';
  const token=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name))?.slice(name.length);
  if(!token || !/^[a-f0-9]{64}$/.test(token))return null;
  return first(env.DB,'SELECT a.id,a.country,a.display_name,a.role,s.strong,s.digest FROM accounts a JOIN sessions s ON s.owner=a.id WHERE s.digest=? AND s.expires>unixepoch() AND s.policy_version=?',await digest(token),policyVersion);
}
async function provider(env,path,body,access) {
  requireValue(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.AUTH_ORIGIN||'') && env.AUTH_PUBLISHABLE_KEY,503,'Account service has not been connected.');
  const response=await fetch(env.AUTH_ORIGIN+'/auth/v1/'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{apikey:env.AUTH_PUBLISHABLE_KEY,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{})});
  requireValue(response.ok,response.status===429?429:response.status>=500?503:401,'The identity provider could not complete sign-in.');
  return response.json();
}
export function providerNames(env){
  return (env.OAUTH_PROVIDERS||'').split(',').map(v=>v.trim()).filter(v=>['google','github','discord'].includes(v));
}
function configured(env){
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.AUTH_ORIGIN||'') && !!env.AUTH_PUBLISHABLE_KEY;
}
export async function auth(request,env,ctx,path,body,user) {
  const db=env.DB,local=ctx.local===true;
  if(path==='logout'){
    if(user)await run(db,'DELETE FROM sessions WHERE digest=?',user.digest);
    return json({signedOut:true},200,{'Set-Cookie':sessionCookie(cookieName(local),'',0,local)});
  }
  requireValue(['request','verify','exchange','oauth'].includes(path),404,'Unknown sign-in method.');
  await limit(db,'auth:'+await digest(ctx.ip||'unknown'),18,600);
  requireAcceptance(body.acceptance);
  if(path==='oauth'){
    requireValue(!local && configured(env) && providerNames(env).includes(body.provider),503,'This sign-in provider is currently unavailable.');
    requireValue(supportedCountry(body.country),400,'Select an EU account country.');
    const nonce=randomToken(),verifier=randomToken();
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    const challenge=btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    const endpoint=new URL('/auth/v1/authorize',env.AUTH_ORIGIN);
    endpoint.search=new URLSearchParams({provider:body.provider,code_challenge:challenge,code_challenge_method:'s256',redirect_to:new URL('/auth/callback',request.url).href});
    await run(db,'INSERT INTO oauth_flows VALUES(?,?,?,?,?,unixepoch(),unixepoch()+600)',await digest(nonce),verifier,body.provider,body.country,policyVersion);
    return json({url:endpoint.href},200,{'Set-Cookie':sessionCookie('__Host-el-flow',nonce,600,false)});
  }
  const email=path==='exchange'||(path==='verify'&&local)?null:field(body.email,3,254,'email').toLowerCase();
  if(email)requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Check the email address.');
  if(path==='request'){
    requireValue(!local,400,'Use the local test invitation.');
    requireValue(supportedCountry(body.country)&&ctx.country===body.country,403,'Confirm your EU account country.');
    await provider(env,'otp',{email,create_user:true});return json({sent:true});
  }
  if(local && path==='verify'){
    const code=field(body.code,32,128,'invitation');
    const invite=await first(db,'DELETE FROM invitations WHERE digest=? AND expires>unixepoch() RETURNING owner,strong',await digest(code));
    requireValue(invite,401,'Invalid or expired invitation.');
    return createSession(db,invite.owner,invite.strong,1800,true,'invitation',clock());
  }
  const access=path==='exchange'?field(body.accessToken,30,8192,'session'):(await provider(env,'verify',{email,token:field(body.code,4,12,'email code'),type:'email'})).access_token;
  return verifiedSession(env,ctx,access,body.country,path==='exchange'?'provider-session':'email',clock());
}
async function verifiedSession(env,ctx,access,country,method,acceptedAt){
  const identity=await provider(env,'user',null,access);
  requireValue(identity.id && identity.email_confirmed_at,401,'Verify the account email first.');
  const claims=JSON.parse(atob(access.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  requireValue(claims.sub===identity.id && claims.exp>clock(),401,'Session expired.');
  const existing=await first(env.DB,'SELECT country FROM accounts WHERE id=?',identity.id);
  if(!existing)requireValue(supportedCountry(country)&&ctx.country===country,403,'Confirm your EU account country.');
  return createSession(env.DB,identity.id,claims.aal==='aal2'?1:0,Math.min(1800,claims.exp-clock()),false,method,acceptedAt,existing?.country||country);
}
async function createSession(db,owner,strong,ttl,local,method,acceptedAt,country){
  const token=randomToken(),statements=[];
  if(country)statements.push(db.prepare('INSERT OR IGNORE INTO accounts(id,country) VALUES(?,?)').bind(owner,country));
  statements.push(db.prepare('INSERT INTO policy_acceptances(owner,version,documents,method,accepted_at) VALUES(?,?,?,?,?)').bind(owner,policyVersion,JSON.stringify(policies.map(p=>p.id)),method,acceptedAt),
    db.prepare('INSERT INTO sessions(digest,owner,expires,strong,policy_version) VALUES(?,?,?,?,?)').bind(await digest(token),owner,clock()+ttl,strong,policyVersion),
    db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'session.created',?)").bind(owner,owner));
  await db.batch(statements);
  return json({signedIn:true},200,{'Set-Cookie':sessionCookie(cookieName(local),token,ttl,local)});
}
export async function callback(request,env,ctx){
  const nonce=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-el-flow=([a-f0-9]{64})(?:;|$)/)?.[1];
  requireValue(nonce,401,'Start sign-in again from your EuroLoot account.');
  const flow=await first(env.DB,'DELETE FROM oauth_flows WHERE digest=? AND expires>unixepoch() AND version=? RETURNING *',await digest(nonce),policyVersion);
  requireValue(flow,401,'This sign-in request has expired. Start again.');
  const code=field(new URL(request.url).searchParams.get('code'),8,1024,'provider authorisation');
  const result=await provider(env,'token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier});
  const session=await verifiedSession(env,ctx,result.access_token,flow.country,flow.method,flow.started);
  return new Response(null,{status:303,headers:{Location:'/retail/#account','Set-Cookie':session.headers.get('set-cookie')}});
}
