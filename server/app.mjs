import {supportedCountry,field,json,secure,requireValue,first,rows,run,input,digest,randomToken,HttpError} from './policy.mjs';
import {auth,current,limit} from './accounts.mjs';
import {stripeCheckout,webhook} from './payments.mjs';
const productFields='id,title,summary,category,cents,fixture';
const regionSQL="(json_array_length(countries)=0 OR ? IN (SELECT value FROM json_each(countries)))";
const isStaff=u=>u.strong===1 && ['admin','sysadmin'].includes(u.role);
const handlesTickets=u=>isStaff(u)||(u.strong===1&&u.role==='support');
const queries={
  basket:'SELECT p.id,p.title,p.cents FROM basket b JOIN products p ON p.id=b.product WHERE b.owner=? ORDER BY p.title',
  wishlist:'SELECT p.id,p.title,p.cents FROM wishlist b JOIN products p ON p.id=b.product WHERE b.owner=? ORDER BY p.title',
  library:'SELECT p.id,p.title,g.order_id,r.version,r.sha256,r.bytes,r.filename FROM grants g JOIN products p ON p.id=g.product LEFT JOIN releases r ON r.product=p.id AND r.published=1 WHERE g.owner=? ORDER BY p.title,r.version',
  orders:'SELECT id,total,discount,coupon,country,mode,state,created FROM orders WHERE owner=? ORDER BY created DESC,rowid DESC',
  tickets:'SELECT id,category,subject,body,state,created FROM tickets WHERE owner=? ORDER BY created DESC,rowid DESC',
  submissions:'SELECT id,studio,title,details,state,created FROM submissions WHERE owner=? ORDER BY created DESC,rowid DESC'
};
async function checkout(env,ctx,user,body,request) {
  const db=env.DB;
  requireValue(env.SANDBOX==='1',403,'Retail sales are closed.');
  const idempotency=field(body.requestKey,36,36,'checkout reference');
  requireValue(/^[a-f\d-]{36}$/.test(idempotency),400,'Invalid checkout reference.');
  requireValue(supportedCountry(user.country)&&body.billingCountry===user.country,403,'The billing country must match this account.');
  const coupon=body.coupon?field(body.coupon,1,30,'coupon').toUpperCase():null;
  const mode=ctx.local?'local-test':'stripe-test';
  if(mode==='stripe-test')requireValue(/^sk_test_/.test(env.STRIPE_TEST_KEY||'') && env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),503,'Sandbox checkout has not been connected.');
  const existing=()=>first(db,'SELECT * FROM orders WHERE owner=? AND request_key=?',user.id,idempotency);
  let order=await existing();
  if(!order){
    const id=crypto.randomUUID();
    try{
      const insert=db.prepare('INSERT INTO orders(id,owner,request_key,country,coupon,mode) VALUES(?,?,?,?,?,?)').bind(id,user.id,idempotency,user.country,coupon,mode);
      const finish=db.prepare("UPDATE orders SET state='complete' WHERE id=? AND (mode='local-test' OR total=0)").bind(id);
      await db.batch([insert,finish]);
    }catch(error){
      order=await existing();
      if(!order){
        const raw=String(error.cause?.message||error.message);
        for(const item of ['empty basket','invalid promotion','already owned','pending order','item unavailable','region mismatch']){
          if(raw.includes(item))throw new HttpError(409,'Checkout could not proceed: '+item+'.');
        }
        throw error;
      }
    }
    order??=await existing();
  }
  requireValue(order.coupon===coupon && order.country===body.billingCountry,409,'This reference was used with different checkout details.');
  const url=order.state==='pending'?await stripeCheckout(env,order,new URL(request.url).origin):null;
  return json({id:order.id,state:order.state,total:order.total,discount:order.discount,url,mode:order.mode});
}
async function download(env,ctx,user,token,request){
  const key=await digest(token);
  const record=await first(env.DB,`SELECT r.* FROM download_tokens d JOIN releases r ON r.object_key=d.object_key JOIN grants g ON g.product=r.product AND g.owner=d.owner JOIN products p ON p.id=g.product
    WHERE d.digest=? AND d.owner=? AND d.expires>unixepoch() AND r.published=1 AND p.available=1 AND ${regionSQL}`,key,user.id,ctx.country);
  requireValue(record,403,'This download is unavailable or has expired.');
  await limit(env.DB,'file:'+user.id,60,600);
  const range=request.headers.get('range');
  let start=0,end=record.bytes-1;
  if(range){
    const match=/^bytes=(\d+)-(\d*)$/.exec(range);
    requireValue(match,416,'Unsupported byte range.');
    start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;
    requireValue(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end,416,'Range unavailable.');
  }
  const object=await env.BUILDS?.get(record.object_key,range?{range:{offset:start,length:end-start+1}}:undefined);
  requireValue(object && object.size===record.bytes,503,'Release file is unavailable.');
  return new Response(object.body,{status:range?206:200,headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':'bytes '+start+'-'+end+'/'+record.bytes}:{}),'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+record.filename.replace(/[^a-zA-Z0-9._-]/g,'_')+'"','Content-Length':String(end-start+1),'X-Content-SHA256':record.sha256}});
}
async function handle(request,env,ctx){
  const url=new URL(request.url),p=url.pathname,method=request.method,db=env.DB;
  if(p==='/healthz' && method==='GET'){requireValue(db,503,'Database unavailable.');await first(db,'SELECT id FROM accounts LIMIT 1');return json({status:'ok',commerce:'sandbox-only'});}
  if(p==='/webhooks/stripe' && method==='POST')return webhook(request,env);
  requireValue(supportedCountry(ctx.country),403,'EuroLoot serves the European Union. Your connection could not be verified in a supported country.');
  if(!p.startsWith('/api/')){
    requireValue(method==='GET'||method==='HEAD',405,'Method unavailable.');
    return env.ASSETS.fetch(request);
  }
  const action=p.slice(5),write=method==='POST';
  requireValue(method==='GET'||write,405,'Method unavailable.');
  if(write)requireValue(request.headers.get('origin')===url.origin,403,'The request origin is not permitted.');
  requireValue(db,503,'Retail backend is unavailable.');
  const body=write?await input(request):{};
  if(!write&&action==='catalog')return json({items:await rows(db,`SELECT ${productFields} FROM products WHERE available=1 AND (fixture=0 OR ?='1') AND ${regionSQL} ORDER BY title`,env.SANDBOX||'0',ctx.country),sandbox:env.SANDBOX==='1'});
  const u=await current(request,env,ctx.local===true);
  if(!write&&action==='session')return json({country:ctx.country,local:ctx.local===true,sandbox:env.SANDBOX==='1',account:u?{id:u.id,country:u.country,name:u.display_name,role:u.role,staff:isStaff(u),support:handlesTickets(u)}:null});
  if(write&&action.startsWith('auth/'))return auth(request,env,ctx,action.slice(5),body,u);
  requireValue(u && supportedCountry(u.country),401,'Sign in to continue.');
  if(write)await limit(db,'write:'+u.id,90,60);
  if(!write&&Object.hasOwn(queries,action))return json({items:await rows(db,queries[action],u.id)});
  if(!write&&action==='order'){
    const id=field(url.searchParams.get('id'),36,36,'order');
    const order=await first(db,'SELECT id,total,discount,country,state,mode,created FROM orders WHERE owner=? AND id=?',u.id,id);
    requireValue(order,404,'Order unavailable.');
    return json({...order,lines:await rows(db,'SELECT product,title,cents FROM lines WHERE order_id=? ORDER BY title',id)});
  }
  if(write&&action==='orders/resume'){
    const o=await first(db,"SELECT * FROM orders WHERE id=? AND owner=? AND mode='stripe-test' AND state='pending'",field(body.id,36,36,'order'),u.id);
    requireValue(o,404,'Pending order unavailable.');
    return json({url:await stripeCheckout(env,o,url.origin)});
  }
  if(!write&&action==='export'){
    const result={profile:{name:u.display_name,country:u.country,role:u.role}};
    for(const [name,sql] of Object.entries(queries))result[name]=await rows(db,sql,u.id);
    return json(result,200,{'Content-Disposition':'attachment; filename="EuroLoot-account.json"'});
  }
  if(write&&action==='profile'){await run(db,'UPDATE accounts SET display_name=? WHERE id=?',field(body.name,1,70,'display name'),u.id);return json({saved:true});}
  if(write&&action==='sessions/revoke'){await run(db,'DELETE FROM sessions WHERE owner=?',u.id);return json({revoked:true});}
  if(write&&['basket','wishlist'].includes(action)){
    const id=field(body.product,1,90,'product');
    requireValue(typeof body.add==='boolean',400,'Specify a basket or wishlist action.');
    if(body.add){
      requireValue(await first(db,`SELECT id FROM products WHERE id=? AND available=1 AND (fixture=0 OR ?='1') AND ${regionSQL}`,id,env.SANDBOX||'0',ctx.country),404,'Product unavailable.');
      await run(db,`INSERT OR IGNORE INTO ${action}(owner,product) VALUES(?,?)`,u.id,id);
    }else await run(db,`DELETE FROM ${action} WHERE owner=? AND product=?`,u.id,id);
    return json({items:await rows(db,queries[action],u.id)});
  }
  if(write&&action==='checkout')return checkout(env,ctx,u,body,request);
  if(write&&action==='download'){
    await limit(db,'download:'+u.id,20,600);
    const r=await first(db,`SELECT r.* FROM grants g JOIN releases r ON r.product=g.product JOIN products p ON p.id=g.product WHERE g.owner=? AND g.product=? AND r.version=? AND r.published=1 AND p.available=1 AND ${regionSQL}`,u.id,field(body.product,1,90,'product'),field(body.version,1,40,'version'),ctx.country);
    requireValue(r,403,'No active entitlement for that release.');
    const token=randomToken();
    await db.batch([db.prepare('INSERT INTO download_tokens VALUES(?,?,?,unixepoch()+120)').bind(await digest(token),u.id,r.object_key),db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'download.issued',?)").bind(u.id,r.product)]);
    return json({url:'/api/files/'+token,version:r.version,sha256:r.sha256,filename:r.filename,bytes:r.bytes,expiresIn:120});
  }
  if(!write&&action.startsWith('files/'))return download(env,ctx,u,action.slice(6),request);
  if(write&&action==='tickets'){
    await limit(db,'ticket:'+u.id,6,3600);
    requireValue(['Account','Order','Refund','Download','Developer','Privacy'].includes(body.category),400,'Choose a support category.');
    const id=crypto.randomUUID();await run(db,'INSERT INTO tickets(id,owner,category,subject,body) VALUES(?,?,?,?,?)',id,u.id,body.category,field(body.subject,3,120,'subject'),field(body.details,10,2400,'details'));return json({id},201);
  }
  if(write&&action==='submissions'){
    await limit(db,'submit:'+u.id,4,3600);
    const id=crypto.randomUUID();await run(db,'INSERT INTO submissions(id,owner,studio,title,details) VALUES(?,?,?,?,?)',id,u.id,field(body.studio,2,100,'studio'),field(body.title,2,120,'title'),field(body.details,10,2400,'submission details'));return json({id},201);
  }
  if(action.startsWith('admin/')){
    const kind=action.slice(6);
    requireValue(kind==='tickets'?handlesTickets(u):isStaff(u),403,'A privileged, strongly authenticated account is required.');
    if(!write){
      if(kind==='status')return json(await first(db,"SELECT (SELECT count(*) FROM accounts) accounts,(SELECT count(*) FROM tickets WHERE state='open') openTickets,(SELECT count(*) FROM orders WHERE state='pending') pendingOrders,(SELECT count(*) FROM submissions WHERE state='submitted') awaitingReview"));
      if(['tickets','submissions'].includes(kind))return json({items:await rows(db,`SELECT * FROM ${kind} ORDER BY created DESC,rowid DESC LIMIT 100`)});
      if(kind==='promotions')return json({items:await rows(db,'SELECT p.*,r.countries,r.exclusions FROM promotions p LEFT JOIN promotion_rules r USING (code) ORDER BY p.starts DESC LIMIT 100')});
      if(kind==='audit')return json({items:await rows(db,'SELECT * FROM audit ORDER BY id DESC LIMIT 100')});
    }else if(['tickets','submissions'].includes(kind)){
      const states=kind==='tickets'?['open','in_review','closed']:['submitted','under_review','changes_requested','approved','rejected'];
      requireValue(states.includes(body.state),400,'Invalid status.');
      const id=field(body.id,36,36,'record ID');
      requireValue(await first(db,`SELECT id FROM ${kind} WHERE id=?`,id),404,'Record unavailable.');
      await db.batch([db.prepare(`UPDATE ${kind} SET state=? WHERE id=?`).bind(body.state,id),
        db.prepare('INSERT INTO audit(actor,action,target) VALUES(?,?,?)').bind(u.id,kind+'.'+body.state,id)]);
      return json({saved:true});
    }else if(kind==='promotions'){
      const code=field(body.code,2,30,'coupon code').toUpperCase();
      requireValue(/^[A-Z0-9_-]+$/.test(code),400,'Use letters, numbers, hyphens or underscores.');
      const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
      requireValue(integer(body.percent,0,100)&&integer(body.fixed,0,1000000)&&((body.percent>0)!==(body.fixed>0)),400,'Choose one discount type.');
      requireValue(integer(body.starts,0,4102444800)&&integer(body.ends,body.starts+1,4102444800)&&integer(body.maxUses,1,1000000)&&integer(body.perAccount,1,body.maxUses),400,'Check the schedule and usage limits.');
      const countries=body.countries??[],exclusions=body.exclusions??[];
      requireValue(Array.isArray(countries)&&countries.length<=27&&countries.every(supportedCountry)&&Array.isArray(exclusions)&&exclusions.length<=100&&exclusions.every(v=>typeof v==='string'&&/^[a-z0-9-]{1,90}$/.test(v)),400,'Invalid regional or product rule.');
      try{
        await db.batch([db.prepare('INSERT INTO promotions VALUES(?,?,?,?,?,?,?)').bind(code,body.percent,body.fixed,body.starts,body.ends,body.maxUses,body.perAccount),
          db.prepare('INSERT INTO promotion_rules VALUES(?,?,?)').bind(code,JSON.stringify(countries),JSON.stringify(exclusions)),
          db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'promotion.created',?)").bind(u.id,code)]);
      }catch(e){if(String(e.cause?.message||e.message).includes('UNIQUE'))throw new HttpError(409,'That coupon already exists.');throw e;}
      return json({code},201);
    }else if(kind==='refund'){
      const id=field(body.id,36,36,'order');const order=await first(db,'SELECT mode,state FROM orders WHERE id=?',id);
      requireValue(order?.mode==='local-test'&&ctx.local&&['complete','refunded'].includes(order.state),409,'Use the payment provider to refund a paid order.');
      await db.batch([db.prepare("UPDATE orders SET state='refunded' WHERE id=? AND state='complete'").bind(id),db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'refund.reviewed',?)").bind(u.id,id)]);return json({refunded:true});
    }
  }
  throw new HttpError(404,'Resource not found.');
}
export async function dispatch(request,env,ctx){
  try{return secure(await handle(request,env,ctx));}
  catch(e){
    const known=e instanceof HttpError;
    if(!known)console.error('Retail request failed',{route:new URL(request.url).pathname.split('/').slice(0,3).join('/'),kind:e.name});
    const message=known?e.message:'The service could not complete this request.';
    if(known && e.status===403 && !new URL(request.url).pathname.startsWith('/api/'))return secure(new Response(message,{status:403,headers:{'Content-Type':'text/plain; charset=utf-8'}}));
    return secure(json({error:message},known?e.status:500));
  }
}
