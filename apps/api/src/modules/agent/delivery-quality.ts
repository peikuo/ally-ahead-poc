// These are conservative, explainable checks, not semantic similarity ranking
// or a cleaner for arbitrary strings. A suspect draft is repaired, never edited.
export function receptionSpeechQualityIssue(speech:string,inputText:string):string|null {
 const text=speech.trim();
 const suffix=/[。！？.!?]\s*"\}$/.exec(text);
 if(!suffix)return null;
 const prose=text.slice(0,suffix.index+1);
 // Require a completed prose sentence followed by an orphan JSON terminator.
 // Literal/code discussion or an enclosing JSON/quoted example is ambiguous:
 // leave it alone. In particular, preserve legitimate user-provided delimiters.
 if(/[{}"`]/.test(prose)||/[{}"`]/.test(inputText))return null;
 return 'SPEECH_ORPHAN_PROTOCOL_TERMINATOR: a complete prose sentence is followed by an unmatched JSON closing quote and brace; regenerate clean speech, preserving the actual result and component; do not edit quoted code or user literals';
}

function unquotedProse(text:string):string {
 const closes:Record<string,string>={'“':'”','‘':'’','「':'」','『':'』','"':'"','`':'`'};
 let close='',escaped=false,result='';
 for(const char of text){
  if(close){
   if(escaped){escaped=false;continue;}
   if(char==='\\'){escaped=true;continue;}
   if(char===close)close='';
   continue;
  }
  if(closes[char]){close=closes[char]!;result+=' ';continue;}
  result+=char;
 }
 return result;
}

export function communicationHandoffIssue(speech:string):string|null {
 // An explicit second-person question at the end hands control to the user.
 // Quoted examples/questions are not a request for new user input. This is a
 // narrow backstop; the model still decides which work to do and when to stop.
 const prose=unquotedProse(speech).trim();
 const last=prose.split(/[。！!\n]/u).at(-1)??'';
 if(!/[?？]$/.test(last))return null;
 if(/(?:[你您](?:们)?(?:希望|想|是否|能否|方便|可以|能|准备|愿意|需要|决定|选择)|请问)/u.test(last)||/\b(?:would|could|can|will|do|did|are|have)\s+you\b/i.test(last))
  return 'COMMUNICATE_USE_FINAL_REPLY_FOR_USER_INPUT';
 return null;
}

export const deliveredContinuationInstruction='User-visible deliveries have already been approved and published in this run. The delivered communicate receipts in the native history are what the user has already seen, not drafts to paraphrase. Reassess what useful work can continue using existing information. Continue only that work; no fixed tool sequence is required. The final reply should deliver a new result, a necessary user question, or a brief closure referencing the delivered artifact. Do not restate the published answer, regenerate its card or repeat its progress. If user input is needed, ask once in the final reply and end the run.';
