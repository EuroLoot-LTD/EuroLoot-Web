import {cpSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export function build(){
  const out=join(root,'dist');rmSync(out,{recursive:true,force:true});mkdirSync(out);
  for(const name of ['index.html','404.html','pages','retail','css','js','images','robots.txt','manifest.webmanifest','sw.js','desktop-icon-192.png','desktop-icon-512.png']){
    if(!existsSync(join(root,name)))throw Error('Missing required public asset '+name);
    cpSync(join(root,name),join(out,name),{recursive:true});
  }
  const base=process.env.PUBLIC_ORIGIN;
  if(base){
    const url=new URL(base);if(url.protocol!=='https:'||url.origin!==base)throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');
    for(const path of ['index.html','retail/index.html']){
      const file=join(out,path),href=base+'/'+(path==='index.html'?'':'retail/');
      writeFileSync(file,readFileSync(file,'utf8').replace('</head>','<link rel="canonical" href="'+href+'"></head>'));
    }
  }
  console.log('Built '+readdirSync(out).length+' public entries into dist/');
}
if(resolve(process.argv[1]||'')===fileURLToPath(import.meta.url))build();
