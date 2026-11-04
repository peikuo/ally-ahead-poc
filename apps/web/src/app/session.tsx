import type {ReactNode} from 'react';
const anonymous={status:'anonymous' as 'anonymous'|'loading'|'authenticated',account:null as null|{user:{id:string}},spaces:[],epoch:0,refresh:async()=>false};
export function SessionProvider({children}:{children:ReactNode}){return children;}
export function useSession(){return anonymous;}
