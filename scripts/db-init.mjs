import pg from '../apps/api/node_modules/pg/lib/index.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL for a dedicated empty POC database');
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try{await c.query('begin');await c.query("select pg_advisory_xact_lock(2468101214)");
const sql=await readFile(new URL('../database/001_poc.sql',import.meta.url),'utf8');
const digest=createHash('sha256').update(sql).digest('hex');
const exists=(await c.query("select to_regclass('public.poc_schema') is not null as present")).rows[0].present;
if(exists){const v=(await c.query('select version,source_hash from poc_schema')).rows;if(v.length!==1||v[0].version!==1||v[0].source_hash!==digest)throw Error('Unexpected POC schema version');console.log('POC schema v1 already initialized');}
else{const tables=(await c.query("select tablename from pg_tables where schemaname='public'")).rows;if(tables.length)throw Error('Refusing a nonempty database');await c.query(sql);await c.query('insert into poc_schema(version,source_hash) values(1,$1)',[digest]);console.log('Initialized POC schema v1',digest);}
await c.query('commit');}catch(e){await c.query('rollback');throw e;}finally{await c.end();}
