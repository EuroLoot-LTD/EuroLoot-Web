import http from 'node:http';
import {Readable} from 'node:stream';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,invite} from './local-db.mjs';
import {build,root} from './build.mjs';
import {dispatch} from '../server/app.mjs';
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.txt':'text/plain','.webmanifest':'application/manifest+json','.xml':'application/xml'};
export function assets(directory){
  return {async fetch(req){
    let name;
    try{name=decodeURIComponent(new URL(req.url).pathname);}catch{return new Response(null,{status:400});}
    if(name.split('/').some(p=>p.startsWith('.')||p.includes('\\')||p.includes('\0')))return new Response(null,{status:404});
    let path=resolve(directory,'.'+name);
    if(path!==directory && !path.startsWith(directory+sep))return new Response(null,{status:404});
    try{if((await stat(path)).isDirectory())path=resolve(path,'index.html');const content=await readFile(path);return new Response(req.method==='HEAD'?null:content,{headers:{'Content-Type':contentTypes[extname(path)]||'application/octet-stream'}});}
    catch{return new Response(await readFile(resolve(directory,'404.html')),{status:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  }};
}
export function localEnvironment(db){
  return {DB:db,SANDBOX:'1',ASSETS:assets(resolve(root,'dist')),BUILDS:{async get(key,options){
    if(key!=='test/receipt-1.txt')return null;const body=await readFile(resolve(root,'fixtures/receipt.txt'));const r=options?.range;return {body:r?body.subarray(r.offset,r.offset+r.length):body,size:body.length};
  }}};
}
export function createLocalServer(env,country='IE'){
  return http.createServer(async(req,res)=>{
    try{
      const port=req.socket.localPort,origin='http://127.0.0.1:'+port;
      // Restrict the Host to the bound loopback origin, including on GET. Never trust forwarded headers.
      if(req.headers.host!=='127.0.0.1:'+port || !req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(403).end();return;}
      const url=new URL(req.url,origin);if(url.origin!==origin){res.writeHead(403).end();return;}
      const options={method:req.method,headers:req.headers};
      if(!['GET','HEAD'].includes(req.method))Object.assign(options,{body:Readable.toWeb(req),duplex:'half'});
      const response=await dispatch(new Request(url,options),env,{local:true,country,ip:'loopback'});
      res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
}
if(resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
  build();const db=openDatabase(process.env.EUROLOOT_DB||'.state/retail.sqlite',true);
  const server=createLocalServer(localEnvironment(db));
  server.listen(Number(process.env.PORT||4173),'127.0.0.1',async()=>{
    console.log('EuroLoot local staging: http://127.0.0.1:'+server.address().port+'/retail/');
    console.log('Customer invitation (15 minutes, one use): '+await invite(db,'fixture-customer'));
  });
}
