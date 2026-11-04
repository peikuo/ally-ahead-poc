import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
const event = 'ally:navigate';
export function navigate(path:string,replace=false) {
  const target=new URL(path,location.origin);
  if(target.origin!==location.origin)throw new Error('Navigation must be same-origin');
  const next=target.pathname+target.search+target.hash;
  const same=next===location.pathname+location.search+location.hash;
  history[replace||same?'replaceState':'pushState'](null,'',next);
  dispatchEvent(new Event(event));
  window.scrollTo({top:0,behavior:'instant'});
}
function subscribe(callback:()=>void){addEventListener('popstate',callback);addEventListener(event,callback);return()=>{removeEventListener('popstate',callback);removeEventListener(event,callback);};}
export function useRoute(){return useSyncExternalStore(subscribe,()=>location.pathname+location.search);}
export function AppLink({href,onClick,...props}:AnchorHTMLAttributes<HTMLAnchorElement> & {href:string}) {
  function click(e:MouseEvent<HTMLAnchorElement>){onClick?.(e);if(!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&!props.target){e.preventDefault();navigate(href);}}
  return <a href={href} onClick={click} {...props}/>;
}
export function tenantFromPath(path:string){return /^\/spaces\/([^/?]+)/.exec(path)?.[1] ?? null;}
