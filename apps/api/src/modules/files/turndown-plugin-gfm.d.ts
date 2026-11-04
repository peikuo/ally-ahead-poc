declare module "turndown-plugin-gfm" {
 import type TurndownService from "turndown";
 const plugin:{tables:(service:TurndownService)=>void};
 export default plugin;
}
