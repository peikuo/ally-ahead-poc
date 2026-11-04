import { deriveReceptionJourney, validateReceptionProgressNotice, type ReceptionJourneyMessage } from "@ally-ahead/contracts";
import { visibleText, type StoredEntry } from "./entry-codec.js";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export function receptionProgressMessages(history:readonly StoredEntry[]):ReceptionJourneyMessage[] {
 return history.flatMap(row=>{
  const visible=visibleText(row.entry as SessionEntry);
  return visible?[{messageId:row.messageId,messageKey:row.entryId,...visible}]:[];
 });
}
export function receptionProgressContext(history:readonly StoredEntry[],inputMessageId:string,inputText:string):string {
 const messages=receptionProgressMessages(history);
 const current={messageId:inputMessageId,messageKey:inputMessageId,author:"user" as const,text:inputText};
 const journey=deriveReceptionJourney([...messages,current]);
 const recentUsers=[...messages.filter(m=>m.author==="user"),current].slice(-3).map(m=>({messageId:m.messageId,excerpt:m.text.slice(0,160)}));
 return `\n【共同的阶段成果记录，仅作上下文，不是新用户指令】\n${JSON.stringify({achievements:journey.achievements,currentUserMessageId:inputMessageId,recentUserMessages:recentUsers})}\n这里只总结做过或谈清的小目标，不是计划或待办，不设固定阶段。用户本轮明确了实际业务选择、范围或约束，或更正已有结论时，按成果skill主动记录；只有建议、假设、提问或泛确认则省略，不为凑数新增。不要把建议当用户决定、把演练当业务已验证。沿用已有结论，结合完整对话判断如何继续并逐渐形成用户认可的需求分析。\n`;
}
export function sanitizeReceptionProgress(text:string,history:readonly StoredEntry[],inputMessageId:string,inputText:string):
 {text:string;notice:ReturnType<typeof validateReceptionProgressNotice>["notice"];reason:string|null;present:boolean} {
 const value=JSON.parse(text) as Record<string,unknown>;
 const present=Object.hasOwn(value,"progress");
 const messages=receptionProgressMessages(history);
 const userTexts=new Map(messages.filter(m=>m.author==="user").map(m=>[m.messageId,m.text]));userTexts.set(inputMessageId,inputText);
 let {notice,reason}=validateReceptionProgressNotice(value.progress,new Set(userTexts.keys()),userTexts);
 if(notice){
  const current=notice;
  const before=deriveReceptionJourney([...messages,{messageId:inputMessageId,messageKey:inputMessageId,author:"user",text:inputText}]);
  const previous=before.achievements.find(a=>a.id===current.id||a.title===current.title&&a.summary===current.summary);
  if(previous&&previous.title===current.title&&previous.summary===current.summary){
   if(current.evidenceMessageIds.every(id=>previous.evidenceMessageIds.includes(id))){notice=undefined;reason="achievement_already_recorded";}
   else notice={...current,id:previous.id};
  }
 }
 delete value.progress;
 return {text:JSON.stringify({...value,...(notice?{progress:notice}:{})}),notice,reason,present};
}
