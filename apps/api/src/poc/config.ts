import {resolve} from 'node:path';
export function config(env=process.env){
 const port=Number(env.PORT??3210),ttl=Number(env.SESSION_TTL_HOURS??24);
 if(!Number.isInteger(port)||port<1||port>65535||!Number.isFinite(ttl)||ttl<=0||ttl>168)throw Error('INVALID_CONFIG');
 const origin=new URL(env.APP_ORIGIN??`http://127.0.0.1:${port}`);
 if(origin.origin!==origin.href.replace(/\/$/,'')||!['http:','https:'].includes(origin.protocol))throw Error('INVALID_ORIGIN');
 if(origin.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw Error('HTTPS_REQUIRED');
 const mode=env.AGENT_MODE??'disabled';if(!['disabled','live'].includes(mode))throw Error('INVALID_AGENT_MODE');
 const traceToken=env.TRACE_VIEWER_TOKEN??'';if(traceToken&&!/^[A-Za-z0-9_-]{43,128}$/.test(traceToken))throw Error('INVALID_TRACE_TOKEN');
 if(!env.DATABASE_URL)throw Error('DATABASE_URL_REQUIRED');
 return {port,host:env.HOST??'127.0.0.1',origin:origin.origin,secure:origin.protocol==='https:',ttl,mode,traceToken,storage:resolve(env.FILE_STORAGE_DIR??'.data/files'),databaseUrl:env.DATABASE_URL,modelPath:resolve(env.AGENT_MODEL_CONFIG??'config/model.json'),apiKey:env.AGENT_API_KEY};
}
export type Config=ReturnType<typeof config>;
