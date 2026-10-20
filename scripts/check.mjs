import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function files(dir) {
  const result=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})) {
    const p=path.join(dir,e.name);
    if(e.isDirectory()) result.push(...await files(p)); else result.push(p);
  }
  return result;
}
for(const dir of ['dist','backend']) {
  if(!await fs.stat(path.join(root,dir)).catch(()=>null)) continue;
  for(const file of await files(path.join(root,dir))) {
    const text=await fs.readFile(file,'utf8');
    if(/\.(js|gs)$/.test(file)) new vm.Script(text,{filename:file});
    if(file.endsWith('.json')) JSON.parse(text);
    if(/\.(js|gs|json|html|css)$/.test(file) && /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(text)) {
      throw new Error(`Possible Telegram token in ${file}`);
    }
  }
}
// Build in an isolated directory: verification never rewrites local publication files.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'chik-check-'));
try {
  await fs.cp(path.join(root,'dist'),path.join(temp,'dist'),{recursive:true});
  await fs.mkdir(path.join(temp,'scripts'));
  await fs.copyFile(path.join(root,'scripts/build.mjs'),path.join(temp,'scripts/build.mjs'));
  execFileSync(process.execPath,[path.join(temp,'scripts/build.mjs')],{stdio:'pipe'});
  const built=path.join(temp,'docs'), published=path.join(root,'docs');
  const a=(await files(built)).map(p=>path.relative(built,p)).sort();
  const b=(await files(published)).map(p=>path.relative(published,p)).sort();
  if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error('docs/ file list is stale; run node scripts/build.mjs');
  for(const p of a) {
    if(!(await fs.readFile(path.join(built,p))).equals(await fs.readFile(path.join(published,p)))) {
      throw new Error(`docs/${p} is stale; run node scripts/build.mjs`);
    }
  }
  const html=await fs.readFile(path.join(built,'index.html'),'utf8');
  for(const [,ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if(/^(?:[a-z]+:|\/\/)/i.test(ref)) continue;
    const target=path.resolve(built,ref.split(/[?#]/)[0]);
    if(target!==built && !target.startsWith(built+path.sep)) throw new Error(`Invalid asset path: ${ref}`);
    await fs.access(target);
  }
} finally {await fs.rm(temp,{recursive:true,force:true});}
console.log('Syntax, JSON, token pattern, local assets and reproducible docs/: OK');
