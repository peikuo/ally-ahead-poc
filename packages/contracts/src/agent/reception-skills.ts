import { z } from "zod";
const text=z.string().trim().min(1).max(600);
const id=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
export const DirectionComparison=z.strictObject({
 type:z.literal("direction_comparison"),title:z.string().trim().min(1).max(200),
 basis:z.array(text).min(1).max(5),assumptions:z.array(text).max(5),
 directions:z.array(z.strictObject({id,title:z.string().trim().min(1).max(100),approach:text,benefit:text,
  prerequisites:z.array(text).max(4),tradeoff:text,humanRole:text,firstStep:text})).min(2).max(3),
 recommendedDirectionId:id,recommendationReason:text,
});
export const SampleRequest=z.strictObject({type:z.literal("sample_request"),title:z.string().trim().min(1).max(200),task:z.string().trim().min(1).max(300),prompt:text});
export const SampleResult=z.strictObject({type:z.literal("sample_result"),title:z.string().trim().min(1).max(200),task:z.string().trim().min(1).max(300),
 mode:z.enum(["grounded","illustrative"]),output:z.string().trim().min(1).max(4000),
 evidence:z.array(z.strictObject({quote:text,note:text})).max(6),limitations:z.array(text).min(1).max(5),nextStep:text,
});
export const ReceptionSampleInput=z.strictObject({task:z.string().trim().min(1).max(300),
 sample:z.string().trim().min(1).max(3000),reference:z.string().trim().max(6000).default("")});
export type ReceptionSampleInput=z.infer<typeof ReceptionSampleInput>;
const labels={zh:["小样演练","任务：","样例：","参考资料：","未提供"],
 en:["Sample rehearsal","Task:","Sample:","Reference:","Not provided"]} as const;
// A visible, editable user message sent through the same confirmed reception input API.
export function formatReceptionSample(value:ReceptionSampleInput,language:"zh"|"en"="zh"):string{
 const v=ReceptionSampleInput.parse(value),l=labels[language];
 return `${l[0]}\n${l[1]}\n${v.task}\n${l[2]}\n${v.sample}\n${l[3]}\n${v.reference||l[4]}`;
}
export function parseReceptionSample(value:string):ReceptionSampleInput|null{
 for(const l of Object.values(labels)){
  const prefix=`${l[0]}\n${l[1]}\n`;if(!value.startsWith(prefix))continue;
  const sampleMarker=`\n${l[2]}\n`,referenceMarker=`\n${l[3]}\n`;
  const a=value.indexOf(sampleMarker,prefix.length),b=value.indexOf(referenceMarker,a+sampleMarker.length);
  if(a<0||b<0)return null;
  const reference=value.slice(b+referenceMarker.length).trim();
  const result=ReceptionSampleInput.safeParse({task:value.slice(prefix.length,a),sample:value.slice(a+sampleMarker.length,b),reference:reference===l[4]?"":reference});
  return result.success?result.data:null;
 }
 return null;
}
