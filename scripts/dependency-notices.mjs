import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
const rows=[];const notices=[];const seen=new Set();
for(const dir of await readdir('node_modules/.pnpm')){
 const root=join('node_modules/.pnpm',dir,'node_modules');let names;try{names=await readdir(root,{withFileTypes:true});}catch{continue;}
 const candidates=[];for(const x of names){if(x.isSymbolicLink())continue;if(x.name.startsWith('@')){for(const y of await readdir(join(root,x.name),{withFileTypes:true}))if(y.isDirectory()&&!y.isSymbolicLink())candidates.push(join(root,x.name,y.name));}else if(x.isDirectory())candidates.push(join(root,x.name));}
 for(const p of candidates){let pkg;try{pkg=JSON.parse(await readFile(join(p,'package.json'),'utf8'));}catch{continue;}const id=pkg.name+'@'+pkg.version;if(seen.has(id))continue;seen.add(id);
 const files=(await readdir(p)).filter(n=>/^(?:licen[sc]e|copying|notice)(?:[._-]|$)/i.test(n));let included=0;
 for(const file of files){try{const text=await readFile(join(p,file),'utf8');notices.push(`===== ${id}: ${file} =====\n${text}\n`);included++;}catch{}}
 rows.push({package:pkg.name,version:pkg.version,license:pkg.license??'UNDECLARED',repository:typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url??null,licenseFiles:included});
 }}
rows.sort((a,b)=>(a.package+'@'+a.version).localeCompare(b.package+'@'+b.version));await mkdir('third_party',{recursive:true});await writeFile('third_party/DEPENDENCIES.json',JSON.stringify(rows,null,2)+'\n');await writeFile('third_party/DEPENDENCY_NOTICES.txt',notices.join('\n'));console.log(JSON.stringify({packages:rows.length,licenses:[...new Set(rows.map(r=>r.license))],noLicenseFile:rows.filter(r=>!r.licenseFiles).map(r=>r.package+'@'+r.version)},null,2));
