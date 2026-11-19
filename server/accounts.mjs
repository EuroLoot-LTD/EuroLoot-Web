import {first,run,json,field,requireValue,randomToken,digest,supportedCountry} from './policy.mjs';
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
  return first(env.DB,'SELECT a.id,a.country,a.display_name,a.role,s.strong,s.digest FROM accounts a JOIN sessions s ON s.owner=a.id WHERE s.digest=? AND s.expires>unixepoch()',await digest(token));
}
async function provider(env,path,body,access) {
  requireValue(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.AUTH_ORIGIN||'') && env.AUTH_PUBLISHABLE_KEY,503,'Account service has not been connected.');
  const response=await fetch(env.AUTH_ORIGIN+'/auth/v1/'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{apikey:env.AUTH_PUBLISHABLE_KEY,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{})});
  requireValue(response.ok,response.status===429?429:response.status>=500?503:401,'The identity provider could not complete sign-in.');
  return response.json();
}
export async function auth(request,env,ctx,path,body,user) {
  const db=env.DB,local=ctx.local===true;
  if(path==='logout'){
    if(user)await run(db,'DELETE FROM sessions WHERE digest=?',user.digest);
    return json({signedOut:true},200,{'Set-Cookie':sessionCookie(cookieName(local),'',0,local)});
  }
  requireValue(['request','verify','exchange'].includes(path),404,'Unknown sign-in method.');
  await limit(db,'auth:'+await digest(ctx.ip||'unknown'),18,600);
  const email=path==='exchange'||(path==='verify'&&local)?null:field(body.email,3,254,'email').toLowerCase();
  if(email)requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Check the email address.');
  if(path==='request'){requireValue(!local,400,'Use the local test invitation from the terminal.');await provider(env,'otp',{email,create_user:true});return json({sent:true});}
  let owner,strong=0,ttl=1800;
  if(local && path==='verify'){
    const code=field(body.code,32,128,'invitation');
    const invite=await first(db,'DELETE FROM invitations WHERE digest=? AND expires>unixepoch() RETURNING owner,strong',await digest(code));
    requireValue(invite,401,'Invalid or expired invitation.'); owner=invite.owner;strong=invite.strong;
  }else{
    const access=path==='exchange'?field(body.accessToken,30,8192,'session'):(await provider(env,'verify',{email,token:field(body.code,4,12,'email code'),type:'email'})).access_token;
    const identity=await provider(env,'user',null,access);
    requireValue(identity.id && identity.email_confirmed_at,401,'Verify the account email first.');
    // Only interpret claims after the configured provider has verified this exact JWT.
    const claims=JSON.parse(atob(access.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    requireValue(claims.sub===identity.id && claims.exp>clock(),401,'Session expired.');
    owner=identity.id;strong=claims.aal==='aal2'?1:0;ttl=Math.min(ttl,claims.exp-clock());
    const existing=await first(db,'SELECT country FROM accounts WHERE id=?',owner);
    if(!existing){requireValue(supportedCountry(body.country)&&ctx.country===body.country,403,'Select a supported country matching your first sign-in location.');await run(db,'INSERT OR IGNORE INTO accounts(id,country) VALUES(?,?)',owner,body.country);}
  }
  const token=randomToken();
  await db.batch([db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest(token),owner,clock()+ttl,strong),
    db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'session.created',?)").bind(owner,owner)]);
  return json({signedIn:true},200,{'Set-Cookie':sessionCookie(cookieName(local),token,ttl,local)});
}
