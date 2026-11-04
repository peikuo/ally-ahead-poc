import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist/src/modules/agent/skills/reception',{recursive:true});
await cp('src/modules/agent/skills/reception','dist/src/modules/agent/skills/reception',{recursive:true});
