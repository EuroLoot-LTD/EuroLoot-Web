import {readdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
for(const dir of ['server','scripts','js','retail','tests','desktop']){
  for(const entry of readdirSync(dir)){if(/\.(m?js|cjs)$/.test(entry))execFileSync(process.execPath,['--check',dir+'/'+entry],{stdio:'inherit'});}
}
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(!config.assets.run_worker_first || config.assets.directory!=='./dist')throw Error('Public traffic must pass the region gate.');
