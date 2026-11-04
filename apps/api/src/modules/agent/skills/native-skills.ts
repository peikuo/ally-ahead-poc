import { loadSkillsFromDir, formatSkillsForPrompt, createReadToolDefinition, type Skill, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { readFileSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AgentTraceCallback } from '../trace/agent-trace.js';

export const receptionSkillNames=['enterprise-diagnosis','direction-comparison','sample-rehearsal','milestone-recording','reception-documents','requirements-document'] as const;
export type ReceptionSkillName=typeof receptionSkillNames[number];
export const skillPath=(name:ReceptionSkillName)=>`/ally-ahead/reception/skills/${name}/SKILL.md`;
const paths=receptionSkillNames.map(skillPath) as [string,...string[]];
export const nativeSkillReadPolicy=Object.freeze({
 arguments:z.strictObject({path:z.enum(paths),offset:z.number().int().min(1).max(2000).optional(),limit:z.number().int().min(1).max(2000).optional()}),
 result:z.tuple([z.strictObject({type:z.literal('text'),text:z.string().max(50000)})]),
});
let registered:{skills:Skill[];text:ReadonlyMap<string,string>}|undefined;
export function applicationSkills(){
 if(registered)return registered;
 const root=fileURLToPath(new URL('./reception/',import.meta.url));
 // Never discover .pi, cwd, personal skills or paths provided by a request.
 if(lstatSync(root).isSymbolicLink()||readdirSync(root).sort().join("|")!==[...receptionSkillNames].sort().join("|"))throw Error("APPLICATION_SKILLS_NOT_READY");
 for(const name of receptionSkillNames){
  const dir=resolve(root,name),file=resolve(dir,'SKILL.md');
  const directory=lstatSync(dir);
  if(directory.isSymbolicLink()||!directory.isDirectory()||readdirSync(dir).join('|')!=='SKILL.md')throw Error('APPLICATION_SKILLS_NOT_READY');
  const document=lstatSync(file);
  if(document.isSymbolicLink()||!document.isFile()||document.size>40000||realpathSync(file)!==file)throw Error('APPLICATION_SKILLS_NOT_READY');
 }
 const loaded=loadSkillsFromDir({dir:root,source:'ally-reception'});
 if(loaded.diagnostics.length||loaded.skills.length!==receptionSkillNames.length)throw Error('APPLICATION_SKILLS_NOT_READY');
 const text=new Map<string,string>();
 const skills=receptionSkillNames.map(name=>{
  const file=resolve(root,name,'SKILL.md'),skill=loaded.skills.find(s=>s.name===name&&s.filePath===file);
  if(!skill||skill.disableModelInvocation)throw Error('APPLICATION_SKILLS_NOT_READY');
  const content=readFileSync(file,'utf8');if(Buffer.byteLength(content,'utf8')>40000)throw Error('APPLICATION_SKILL_LIMIT');
  text.set(skillPath(name),content);
  return {...skill,filePath:skillPath(name),baseDir:`/ally-ahead/reception/skills/${name}`};
 });
 registered={skills,text};return registered;
}
export function applicationSkillsPrompt(){return formatSkillsForPrompt(applicationSkills().skills,'read');}
export function applicationSkillText(name:ReceptionSkillName){return applicationSkills().text.get(skillPath(name))!;}
export function createApplicationSkillRead(input:{check:()=>Promise<void>;signal:AbortSignal;trace:AgentTraceCallback}):ToolDefinition {
 const allowed=applicationSkills().text;
 const verify=async(path:string)=>{await input.check();input.signal.throwIfAborted();if(!allowed.has(path))throw Error('SKILL_PATH_NOT_ALLOWED');};
 const native=createReadToolDefinition('/ally-ahead/reception',{autoResizeImages:false,operations:{
  access:verify,readFile:async path=>{await verify(path);return Buffer.from(allowed.get(path)!,'utf8');},detectImageMimeType:async path=>{await verify(path);return null;},
 }});
 return {name:native.name,label:native.label,parameters:native.parameters,outputSchema:native.outputSchema,description:'Read only the application SKILL.md paths listed in available_skills. No other filesystem paths, customer documents, images or shell access.',executionMode:'sequential',
  execute:async(id,raw,signal,onUpdate,context)=>{
   const args=nativeSkillReadPolicy.arguments.parse(raw);await verify(args.path);signal?.throwIfAborted();
   await input.trace('tool_started',{name:'read',toolCallId:id,arguments:args});
   const result=await native.execute(id,args,signal,onUpdate,context);
   await verify(args.path);signal?.throwIfAborted();nativeSkillReadPolicy.result.parse(result.content);
   await input.trace('tool_completed',{name:'read',toolCallId:id,result:{path:args.path,content:result.content}});
   return result;
  },
 };
}
