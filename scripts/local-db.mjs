import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {randomToken,digest} from '../server/policy.mjs';
export const root=new URL('../',import.meta.url);
export function openDatabase(path=':memory:',fixtures=false) {
  if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
  const sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000; CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)');
  for(const name of readdirSync(new URL('db/',root)).filter(n=>n.endsWith('.sql')).sort()){
    if(sqlite.prepare('SELECT 1 FROM migrations WHERE name=?').get(name))continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try{sqlite.exec(readFileSync(new URL('db/'+name,root),'utf8'));sqlite.prepare('INSERT INTO migrations VALUES (?)').run(name);sqlite.exec('COMMIT');}
    catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
  if(fixtures)sqlite.exec(readFileSync(new URL('fixtures/sandbox.sql',root),'utf8'));
  function statement(sql,params=[]){
    const query=sqlite.prepare(sql);
    return {bind:(...args)=>statement(sql,args),first:()=>query.get(...params)||null,all:()=>({results:query.all(...params)}),run:()=>query.run(...params)};
  }
  return {sqlite,prepare:statement,batch:async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
export async function invite(db,owner,role='customer'){
  if(!['customer','developer','support','admin'].includes(role))throw Error('Unsupported fixture role');
  if(!/^fixture-[a-z0-9-]{1,60}$/.test(owner))throw Error('Use a fixture account identifier.');
  db.prepare("INSERT OR IGNORE INTO accounts(id,country,role) VALUES(?,'IE',?)").bind(owner,role).run();
  const token=randomToken();
  db.prepare('INSERT INTO invitations VALUES(?,?,unixepoch()+900,?)').bind(await digest(token),owner,Number(['admin','support'].includes(role))).run();
  return token;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const db=openDatabase(process.env.EUROLOOT_DB||'.state/retail.sqlite',true);
  console.log(await invite(db,process.argv[2]||'fixture-customer',process.argv[3]||'customer'));db.sqlite.close();
}
