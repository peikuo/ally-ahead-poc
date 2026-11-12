import {z} from 'zod';
export const RequirementsDocumentOffer=z.strictObject({type:z.literal('requirements_document_offer'),title:z.string().trim().min(1).max(200),prompt:z.string().trim().min(1).max(600)});
export const RequirementsDocument=z.strictObject({type:z.literal('requirements_document'),title:z.string().trim().min(1).max(200),markdown:z.string().trim().min(1).max(40000),evidence:z.array(z.strictObject({messageId:z.uuid(),quote:z.string().trim().min(1).max(2000)})).max(20),replacesMessageId:z.uuid().optional()});
export type RequirementsDocument=z.infer<typeof RequirementsDocument>;
export type RequirementsDocumentRequest={kind:'generate'; directive?:string}|{kind:'revise';documentMessageId?:string;instruction:string};
export function formatRequirementsDocumentRequest(language:'zh'|'en'='zh',revision?:{documentMessageId:string;instruction:string}):string {
 if(!revision)return language==='zh'?'生成需求文档':'Generate a requirements document';
 z.uuid().parse(revision.documentMessageId);const instruction=z.string().trim().min(1).max(10000).parse(revision.instruction);
 return language==='zh'?`修改需求文档\n文档：${revision.documentMessageId}\n修改要求：\n${instruction}`:`Revise requirements document\nDocument: ${revision.documentMessageId}\nChanges:\n${instruction}`;
}
// The ordinary button command remains a whole-message match. Also accept an
// explicit generation sentence with the user's output requirements attached.
function generationSentence(text: string): string | undefined {
 const quoted = /"(?:\\.|[^"\\])*"|“[^”]*”|(?:^|[\s(])'[^']*'|`[^`]*`/gu;
 const quotedRanges = [...text.matchAll(quoted)];
 const pattern = /(?:^|[.!][ \t]+|\r?\n[ \t]*)(Please generate (?:a|the) requirements document(?: in (?:English|Chinese|Markdown))?(?:, including [^.!?;\r\n]+)?(?:[.!](?=\s|$)|(?=$|\r?\n)))/giu;
 const matches = [...text.matchAll(pattern)].filter(match => {
  const start = match.index + match[0].length - match[1]!.length;
  return !quotedRanges.some(range => start >= range.index && start < range.index + range[0].length);
 });
 if (matches.length !== 1) return;
 const directive = matches[0]![1]!;
 if (/\b(?:if|unless|only after|after I|when I|once I|not yet)\b/iu.test(directive) ||
     /\b(?:do not|don['’]t|hold off on|cancel)\s+(?:generat(?:e|ing)|draft(?:ing)?|writ(?:e|ing))\s+(?:(?:a|the|this)\s+)?requirements document\b/iu.test(text))
  return;
 return directive;
}

// Questions, quoted examples, and conditional requests do not authorize a draft.
export function parseRequirementsDocumentRequest(value:string):RequirementsDocumentRequest|null {
 const text=value.trim();
 if(/^(?:请(?:帮我)?|帮我)?(?:重新)?(?:生成|整理|写)(?:一份)?(?:完整的?|可用的?)?需求文档(?:吧)?[。！!]?$/u.test(text)||/^(?:please\s+)?(?:generate|regenerate|create|draft|write)\s+(?:(?:a|the)\s+)?requirements document[.!]?$/iu.test(text))return {kind:'generate'};
 for(const [prefix,marker]of [['修改需求文档\n文档：','\n修改要求：\n'],['Revise requirements document\nDocument: ','\nChanges:\n']] as const){
  if(!text.startsWith(prefix))continue;
  const at=text.indexOf(marker,prefix.length);if(at<0)return null;
  const id=text.slice(prefix.length,at),instruction=text.slice(at+marker.length).trim();
  if(!z.uuid().safeParse(id).success||!instruction||instruction.length>10000)return null;
  return {kind:'revise',documentMessageId:id,instruction};
 }
 const natural=/^(?:请(?:帮我)?|帮我)?修改(?:这份)?需求文档[：:]\s*([\s\S]+)$/u.exec(text)||/^(?:please\s+)?(?:revise|update)\s+(?:the\s+)?requirements document:\s*([\s\S]+)$/iu.exec(text);
 if(natural?.[1]?.trim())return {kind:'revise',instruction:natural[1].trim()};
 const directive=generationSentence(text);
 return directive?{kind:'generate',directive}:null;
}
export function formatRequirementsDocumentConfirmation(documentMessageId:string,language:'zh'|'en'='zh'):string {
 z.uuid().parse(documentMessageId);return language==='zh'?`确认需求文档：${documentMessageId}`:`Confirm requirements document: ${documentMessageId}`;
}
export function parseRequirementsDocumentConfirmation(value:string):string|null {
 const match=/^(?:确认需求文档：|Confirm requirements document: )([0-9a-f-]{36})$/iu.exec(value.trim());
 return match&&z.uuid().safeParse(match[1]).success?match[1]!:null;
}
