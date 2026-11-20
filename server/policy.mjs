export const euCountries = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
export const supportedCountry = code => euCountries.has(code);
export class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
export function requireValue(test,status,message) { if(!test) throw new HttpError(status,message); }
export function field(value,min,max,label) {
  requireValue(typeof value==='string' && value.trim().length>=min && value.trim().length<=max,400,'Check '+label+'.');
  return value.trim();
}
export function json(value,status=200,headers={}) {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
}
export function secure(response) {
  const headers=new Headers(response.headers);
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://www.cheapshark.com; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('X-Robots-Tag','noindex, nofollow');
  headers.set('Strict-Transport-Security','max-age=31536000');
  headers.set('Cache-Control','private, no-store');
  return new Response(response.body,{status:response.status,headers});
}
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
export async function limitedText(request,max=12000) {
  requireValue(Number(request.headers.get('content-length')||0)<=max,413,'Request too large.');
  if(!request.body) return '';
  const reader=request.body.getReader(), chunks=[];
  let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(413,'Request too large.');}chunks.push(value);}
  return new Response(new Blob(chunks)).text();
}
export async function input(request) {
  requireValue(request.headers.get('content-type')?.split(';')[0].trim()==='application/json',415,'Send JSON.');
  try {const obj=JSON.parse(await limitedText(request));requireValue(obj && typeof obj==='object' && !Array.isArray(obj),400,'Invalid request.');return obj;}
  catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid JSON.');}
}
export const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
export const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
