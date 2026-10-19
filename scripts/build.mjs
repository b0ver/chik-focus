import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.rm(path.join(root,'docs'),{force:true,recursive:true});
await fs.cp(path.join(root,'dist'),path.join(root,'docs'),{recursive:true});
await fs.writeFile(path.join(root,'docs/.nojekyll'),'');
console.log('GitHub Pages build ready: docs/.');
