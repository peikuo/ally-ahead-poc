import mammoth from "mammoth";
import TurndownService from "turndown";
import gfmPlugin from "turndown-plugin-gfm";

export type ReceptionDocumentFormat="txt"|"md"|"docx"|"pdf";
export interface DocumentLocation {page?:number;heading?:string;paragraph?:number;lineStart?:number;lineEnd?:number;label:string}
export interface DocumentParagraph {id:number;start:number;end:number;location:DocumentLocation}
export interface ParsedReceptionDocument {
 markdown:string;paragraphs:DocumentParagraph[];quality:"readable"|"partial";
 coverage:{read:string[];unread:string[];unreliable:string[];pageCount?:number};warnings:string[];
}
export class ReceptionParseError extends Error{constructor(readonly reason:string){super(reason);}}
const fail=(reason:string):never=>{throw new ReceptionParseError(reason);};
function normalize(value:string){return value.replace(/\r\n?/g,"\n").replace(/\u0000/g,"\uFFFD").trim();}
function decodeText(bytes:Buffer):string{
 try{
  if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2));
  if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }catch{return fail('text_encoding_unreadable');}
}
// Bound ZIP expansion before handing a DOCX to the converter. No archive extraction to disk.
function checkDocx(bytes:Buffer){
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)fail('docx_invalid_container');
 const count=bytes.readUInt16LE(eocd+10),offset=bytes.readUInt32LE(eocd+16);let cursor=offset,expanded=0;const names=new Set<string>();
 if(count===65535||count>4000)fail('docx_container_limit');
 for(let i=0;i<count;i++){
  if(cursor+46>bytes.length||bytes.readUInt32LE(cursor)!==0x02014b50)fail('docx_invalid_container');
  if(bytes.readUInt16LE(cursor+8)&1)fail('document_password_required');
  expanded+=bytes.readUInt32LE(cursor+24);if(expanded>40*1024*1024)fail('docx_expansion_limit');
  const n=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32);
  if(cursor+46+n+extra+comment>bytes.length)fail('docx_invalid_container');
  const name=bytes.subarray(cursor+46,cursor+46+n).toString('utf8');
  if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..'))fail('docx_invalid_container');
  names.add(name);cursor+=46+n+extra+comment;
 }
 if(!names.has('word/document.xml')||!names.has('[Content_Types].xml'))fail('docx_invalid_container');
}
function appendParagraphs(out:ParsedReceptionDocument,start:number,end:number,format:ReceptionDocumentFormat,page?:number,maxParagraphCharacters=4000){
 const slice=out.markdown.slice(start,end);let heading:string|undefined;
 for(const match of slice.matchAll(/[^\n](?:[^\n]|\n(?!\s*\n))*/g)){
  const text=match[0].trim();if(!text)continue;
  const leading=match[0].length-match[0].trimStart().length,base=start+match.index!+leading;
  const h=/^#{1,6}\s+(.+)/.exec(text);if(h)heading=h[1]!.slice(0,200);
  let cursor=0;
  while(cursor<text.length){
   let stop=Math.min(text.length,cursor+maxParagraphCharacters);
   if(stop<text.length){
    const candidates=[...text.slice(cursor,stop).matchAll(/[。！？.!?]\s*|\n/g)];const boundary=candidates.at(-1);
    if(boundary&&boundary.index!>maxParagraphCharacters/2)stop=cursor+boundary.index!+boundary[0].length;
    if(/[\uD800-\uDBFF]/.test(text[stop-1]??''))stop--;
   }
   const raw=text.slice(cursor,stop),part=raw.trim(),from=base+cursor+(raw.length-raw.trimStart().length),to=from+part.length;
   if(part){
    const paragraph=out.paragraphs.length+1,lineStart=out.markdown.slice(0,from).split('\n').length,lineEnd=lineStart+part.split('\n').length-1;
    const location:DocumentLocation=page?{page,label:`第${page}页`}:format==='docx'
     ?{heading,paragraph,label:`${heading?`标题“${heading}” / `:''}提取正文第${paragraph}段（非Word页码）`}
     :{heading,lineStart,lineEnd,label:`${heading?`标题“${heading}” / `:''}第${lineStart}—${lineEnd}行`};
    out.paragraphs.push({id:paragraph,start:from,end:to,location});
   }
   cursor=stop;
  }
 }
}
export async function parseReceptionDocument(format:ReceptionDocumentFormat,bytes:Buffer,maxCharacters=100000,maxParagraphCharacters=4000):Promise<ParsedReceptionDocument>{
 if(!Number.isSafeInteger(maxParagraphCharacters)||maxParagraphCharacters<16||maxParagraphCharacters>20000)fail('document_limits_invalid');
 const out:ParsedReceptionDocument={markdown:'',paragraphs:[],quality:'readable',coverage:{read:[],unread:[],unreliable:[]},warnings:[]};
 if(format==='txt'||format==='md'){
  out.markdown=normalize(decodeText(bytes));
  if(out.markdown.includes('\uFFFD'))fail('text_encoding_unreadable');
  if(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(out.markdown))fail('text_contains_binary_data');
  appendParagraphs(out,0,out.markdown.length,format,undefined,maxParagraphCharacters);out.coverage.read=['全部可提取正文'];
 }else if(format==='docx'){
  checkDocx(bytes);let images=0;
  const converted=await mammoth.convertToHtml({buffer:bytes},{externalFileAccess:false,includeEmbeddedStyleMap:false,
   convertImage:mammoth.images.imgElement(async()=>{images++;return{src:'unread-embedded-image',alt:'[嵌入图片未读取]'};})});
  const turn=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced'});let uncertainTables=0;
  turn.use(gfmPlugin.tables);turn.remove(['script','style','iframe','object','embed']);
  turn.addRule('unread-image',{filter:'img',replacement:()=> '[嵌入图片未读取]'});
  turn.addRule('docx-table-without-invented-header',{
   filter:node=>node.nodeName==='TABLE'&&(!node.querySelector('th')||!!node.querySelector('[colspan],[rowspan]')),
   replacement:(_content,node)=>{
    const table=node as HTMLElement,rows=Array.from(table.querySelectorAll('tr')).map(row=>Array.from(row.children).filter(c=>['TD','TH'].includes(c.nodeName)).map(cell=>turn.turndown(cell.innerHTML).trim().replace(/\|/g,'\\|').replace(/\r?\n+/g,' / ')));
    const merged=!!table.querySelector('[colspan],[rowspan]');if(merged)uncertainTables++;
    const width=Math.max(0,...rows.map(row=>row.length));if(!width)return '';
    const header=Array.from({length:width},(_,i)=>`列${i+1}`);
    return '\n\n'+(merged?'[复杂表格：合并单元格对应关系未可靠还原]\n':'')+'表格（列编号为提取定位标签，不是原件字段名）\n\n'+[header,header.map(()=> '---'),...rows.map(row=>Array.from({length:width},(_,i)=>row[i]??''))].map(row=>'| '+row.join(' | ')+' |').join('\n')+'\n\n';
   },
  });
  out.markdown=normalize(turn.turndown(converted.value));appendParagraphs(out,0,out.markdown.length,format,undefined,maxParagraphCharacters);
  out.coverage.read=['提取到的标题、段落及简单表格正文'];
  if(images){out.coverage.unread.push(`${images}处嵌入图片内容未读取，位置按提取正文中的标记查找`);out.warnings.push('embedded_images_not_read');}
  if(uncertainTables){out.coverage.unreliable.push(`${uncertainTables}处合并单元格表格结构未可靠还原，勿据此推断对应关系`);out.warnings.push('docx_complex_tables_uncertain');}
  if(converted.messages.length){out.coverage.unreliable.push('转换器报告未完整支持的文档结构，具体原件范围无法全部确认');out.warnings.push('docx_conversion_warnings');}
 }else{
  if(bytes.subarray(0,5).toString()!=='%PDF-')fail('pdf_invalid');
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let pdf:Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>|undefined;
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true,verbosity:0});
  try{
   pdf=await task.promise;
   out.coverage.pageCount=pdf.numPages;if(pdf.numPages>50)fail('pdf_page_limit');
   for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    try{
     const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),items=content.items.filter((i):i is import('pdfjs-dist/types/src/display/api.js').TextItem=>'str'in i);
     let value='',lastY:number|undefined;const starts:number[]=[];
     for(const item of items){const y=item.transform[5] as number;if(lastY!==undefined&&Math.abs(lastY-y)>3){value+='\n';starts.push(item.transform[4] as number);}value+=item.str+(item.hasEOL?'\n':' ');lastY=y;}
     value=normalize(value);const operators=await page.getOperatorList();
     const hasImage=operators.fnArray.some(op=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject].includes(op));
     if(!value){if(hasImage)out.coverage.unread.push(`第${pageNumber}页仅有图片，未执行OCR`);else out.coverage.read.push(`第${pageNumber}页未检测到文字或图片`);continue;}
     const start=out.markdown.length;out.markdown+=(start?'\n\n':'')+`## 第${pageNumber}页\n\n`+value;
     appendParagraphs(out,start,out.markdown.length,format,pageNumber,maxParagraphCharacters);out.coverage.read.push(`第${pageNumber}页提取的文字`);
     if(value.includes('\uFFFD')||(/[\uE000-\uF8FF]/g.test(value)&&((value.match(/[\uE000-\uF8FF]/g)?.length??0)/value.length)>.1)){
      out.coverage.unreliable.push(`第${pageNumber}页存在无法可靠映射的文字/字形，请补充相关原文`);out.warnings.push('pdf_glyph_mapping_uncertain');
     }
     if(hasImage)out.coverage.unread.push(`第${pageNumber}页嵌入图片内容未读取`);
     const width=page.getViewport({scale:1}).width,left=starts.filter(x=>x<width*.4).length,right=starts.filter(x=>x>width*.5).length;
     if(left>=3&&right>=3){out.coverage.unreliable.push(`第${pageNumber}页疑似多栏/表格，阅读顺序未经确认`);out.warnings.push('pdf_layout_uncertain');}
     if(out.markdown.length>maxCharacters)fail('document_text_limit');
    }catch(error){if(error instanceof ReceptionParseError)throw error;out.coverage.unread.push(`第${pageNumber}页文字提取失败`);}
   }
   out.warnings.push('pdf_text_extraction_not_layout_reconstruction');
  }catch(error){if(error instanceof ReceptionParseError)throw error;if(error instanceof Error&&error.name==='PasswordException')fail('document_password_required');fail('pdf_unreadable');}
  finally{await task.destroy();}
 }
 if(!out.markdown.trim()||!out.paragraphs.length)fail('document_text_empty');
 if(out.markdown.length>maxCharacters)fail('document_text_limit');
 if(out.paragraphs.length>5000||Buffer.byteLength(JSON.stringify(out.paragraphs))>2097152)fail('document_paragraph_limit');
 if(out.coverage.unread.length||out.coverage.unreliable.length)out.quality='partial';
 return out;
}
