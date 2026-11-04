import pg from 'pg';
export type Transaction=pg.PoolClient;
export class Database {
 readonly pool:pg.Pool;
 constructor(url:string){this.pool=new pg.Pool({connectionString:url,max:8});}
 async transaction<T>(fn:(tx:Transaction)=>Promise<T>):Promise<T>{const c=await this.pool.connect();try{await c.query('begin');const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
}
