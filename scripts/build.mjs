import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.rm(path.join(root,'docs'),{force:true,recursive:true});
await fs.cp(path.join(root,'dist'),path.join(root,'docs'),{recursive:true});
await fs.writeFile(path.join(root,'docs/.nojekyll'),'');
let html=await fs.readFile(path.join(root,'docs/index.html'),'utf8');
for(const name of ['styles.css','config.js','app.js']){
  const version=createHash('sha256').update(await fs.readFile(path.join(root,'docs',name))).digest('hex').slice(0,12);
  html=html.replaceAll('"'+name+'"','"'+name+'?v='+version+'"');
}
await fs.writeFile(path.join(root,'docs/index.html'),html);
console.log('GitHub Pages build ready: docs/.');
