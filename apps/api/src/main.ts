import {config} from './poc/config.js';
import {createApp} from './poc/app.js';
const cfg=config();const service=await createApp(cfg);
// One process per POC database: acquire a session advisory lock before recovery.
const owner=await service.db.pool.connect();const locked=(await owner.query('select pg_try_advisory_lock(2468101215) as locked')).rows[0].locked;
if(!locked)throw Error('POC_DATABASE_ALREADY_RUNNING');
owner.on('error',()=>{console.error('POC_DATABASE_LOCK_LOST');process.exit(1);});
await owner.query("update runs set state='failed',failure='outcome_unknown',snapshot=null,revision=revision+1 where state in ('pending','running')");
await owner.query("update documents set state='outcome_unknown' where state in ('queued','processing')");
const server=service.app.listen(cfg.port,cfg.host,()=>console.log(`Ally Ahead POC listening on ${cfg.origin}; Agent ${cfg.mode}; Sandbox only`));
let closing=false;async function stop(){if(closing)return;closing=true;server.close();for(const c of service.runner.active.values())c.abort();await Promise.allSettled([...service.runner.active.keys()].map(async()=>{for(let i=0;i<50&&service.runner.active.size;i++)await new Promise(r=>setTimeout(r,100));}));await owner.query('select pg_advisory_unlock(2468101215)');owner.release();await service.close();process.exit(0);}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
