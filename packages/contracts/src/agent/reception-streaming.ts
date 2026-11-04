// Snapshots contain cumulative text, not individual token deltas. Decode only
// the first top-level speech value specified by the output protocol. Never look
// for a nested "speech" property, render raw/plain model output, or parse cards.
// This preview is not validation, approval, persistence or TTS authorization.
export function receptionStreamingText(text:string):string {
  if(text.length>262144)return "";
  const source=text.trimStart().replace(/^```(?:json)?\s*/i,"");
  const header=/^\{\s*"speech"\s*:\s*"/.exec(source);
  if(!header)return "";
  const output:string[]=[];
  let highSurrogate="";
  const append=(unit:string):boolean=>{
    const code=unit.charCodeAt(0);
    if(highSurrogate){
      if(code<0xdc00||code>0xdfff)return false;
      output.push(highSurrogate+unit);highSurrogate="";return true;
    }
    if(code>=0xd800&&code<=0xdbff){highSurrogate=unit;return true;}
    if(code>=0xdc00&&code<=0xdfff)return false;
    output.push(unit);return true;
  };
  for(let i=header[0].length;i<source.length;i++){
    let unit=source[i]!;
    if(unit==='"')break;
    if(unit==='\\'){
      const escaped=source[++i];
      if(escaped===undefined)break;
      if(escaped==='u'){
        const hex=source.slice(i+1,i+5);
        if(!/^[0-9a-fA-F]{4}$/.test(hex))break;
        unit=String.fromCharCode(Number.parseInt(hex,16));i+=4;
      }else{
        switch(escaped){
          case '"':unit='"';break;
          case '\\':unit='\\';break;
          case '/':unit='/';break;
          case 'b':unit='\b';break;
          case 'f':unit='\f';break;
          case 'n':unit='\n';break;
          case 'r':unit='\r';break;
          case 't':unit='\t';break;
          default:return output.join("");
        }
      }
    }else if(unit.charCodeAt(0)<0x20)break;
    if(!append(unit))break;
  }
  // Incomplete escapes and unpaired surrogates are held back until a later
  // cumulative snapshot contains the rest. No replacement character is guessed.
  return output.join("");
}
