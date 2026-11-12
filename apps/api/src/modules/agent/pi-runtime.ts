import { createAgentSession, createExtensionRuntime, CURRENT_SESSION_VERSION, ModelRuntime,
  SessionManager, SettingsManager, type ResourceLoader, type SessionEntry, type Skill } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { AgentRuntime } from "./agent.ports.js";
import { assertSafeText, captureEntry, canonicalUserEntry, validateHistory, type EntryPolicy, type StoredEntry } from "./entry-codec.js";
import { VIRTUAL_CWD, SYSTEM_PROMPT } from "./agent-policy.js";
import { createReceptionTools, isReceptionToolPolicy, readCaseIds, receptionKnowledgeInstructions, receptionDocumentContext } from "./reception-tools.js";
import { receptionSpeechQualityIssue, communicationHandoffIssue, deliveredContinuationInstruction } from "./delivery-quality.js";
import { createCommunicateTool, communicatedPresentation, communicateArgumentIssue, type CommunicationResult } from "./communicate.js";
import { decodeReceptionPresentation, ReceptionPresentation } from "@ally-ahead/contracts";
import { receptionProgressContext, sanitizeReceptionProgress } from "./reception-progress.js";
import { traceFailure } from "./trace/agent-trace.js";
import { applicationSkills, applicationSkillText, createApplicationSkillRead } from "./skills/native-skills.js";
import { assembleRequirementsDocument, isRequirementsDocumentDraft, parseRequirementsEvidenceRefs, prepareRequirementsDocument, requirementsDocumentDelivery } from "./requirements-document.js";
import { prepareReceptionSkills } from "./skills/reception-skills.js";
import { parseReceptionOutput, declaredReceptionInteraction, receptionOutputIssues } from "./reception-output.js";
export { VIRTUAL_CWD, SYSTEM_PROMPT } from "./agent-policy.js";
export function restoreManager(demandId: string, history: ReadonlyArray<StoredEntry>, policy: EntryPolicy): SessionManager {
  if (!/^[0-9a-f-]{36}$/i.test(demandId)) throw new Error("INVALID_DEMAND_ID");
  const entries = validateHistory(history, policy);
  return SessionManager.inMemory(VIRTUAL_CWD, { id: demandId }, [{type:"session",version:CURRENT_SESSION_VERSION,
    id:demandId,cwd:VIRTUAL_CWD,timestamp:entries[0]?.timestamp ?? new Date().toISOString()}, ...entries]);
}
export function receptionResources(skills:Skill[]=[]): ResourceLoader {
  const loaded = {extensions:[],errors:[],runtime:createExtensionRuntime()};
  return { getExtensions:()=>loaded, getSkills:()=>({skills,diagnostics:[]}),
    getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),
    getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=>SYSTEM_PROMPT,getSystemPromptSource:()=>undefined,
    getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources:()=>{throw new Error("RESOURCES_DISABLED");},reload:async()=>{} };
}
// No auth.json, models.json, filesystem catalog, discovery or startup catalog network request.
// Composition root supplies only an explicitly selected model and credential later.
export async function createIsolatedModelRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({ credentials:new InMemoryCredentialStore(), modelsStore:new InMemoryModelsStore(),
    modelsPath:null, allowModelNetwork:false, refreshOnCreate:false });
}
export class PiRuntime implements AgentRuntime {
  constructor(readonly runtime:ModelRuntime, readonly model:Model<Api>, readonly snapshotIntervalMs=500, readonly correctionPolicy={maxCorrections:3,totalTimeoutMs:120000}) {
    if(!Number.isSafeInteger(snapshotIntervalMs)||snapshotIntervalMs<1||snapshotIntervalMs>10000) throw new Error("INVALID_SNAPSHOT_INTERVAL");
    if(!Number.isInteger(correctionPolicy.maxCorrections)||correctionPolicy.maxCorrections<0||correctionPolicy.maxCorrections>3||!Number.isInteger(correctionPolicy.totalTimeoutMs)||correctionPolicy.totalTimeoutMs<1)throw new Error("INVALID_CORRECTION_POLICY");
  }
  async run(input: Parameters<AgentRuntime["run"]>[0]): Promise<void> {
    const emit=input.trace??(async()=>{}),started=Date.now();
    await emit("runtime_started",{inputMessageId:input.inputMessageId,inputText:input.inputText,inputCreatedAt:input.inputCreatedAt});
    try{await this.executeRun(input,started);}catch(error){
      try{await emit("runtime_failed",{reason:traceFailure(error),durationMs:Date.now()-started,aborted:input.signal.aborted});}catch{}
      throw error;
    }
  }
  private async executeRun(input: Parameters<AgentRuntime["run"]>[0],runtimeStarted:number): Promise<void> {
    const emit=input.trace??(async()=>{});
    if(input.signal.aborted) throw new Error("RUN_CANCELLED");
    if(!this.runtime.hasConfiguredAuth(this.model.provider)) throw new Error("MODEL_NOT_CONFIGURED");
    if(input.policy.tools.size && !isReceptionToolPolicy(input.policy.tools)) throw new Error("TOOLS_NOT_INTEGRATED");
    if(!input.policy.models.some(m=>m.provider===this.model.provider&&m.modelId===this.model.id&&m.api===this.model.api)) throw new Error("MODEL_NOT_APPROVED");
    assertSafeText(input.inputText);
    if(input.history.some(row=>row.messageId===input.inputMessageId)) throw new Error("INPUT_ALREADY_MAPPED");
    let manager = restoreManager(input.demandId, input.history, input.policy);
    const savedHistoryLength = manager.getEntries().length;
    const selection = manager.buildSessionContext().model;
    if(selection?.provider!==this.model.provider || selection.modelId!==this.model.id) manager.appendModelChange(this.model.provider,this.model.id);
    if(!manager.getEntries().some(e=>e.type==="thinking_level_change")) manager.appendThinkingLevelChange("off");
    const user = canonicalUserEntry({messageId:input.inputMessageId,body:input.inputText,createdAt:input.inputCreatedAt,parentEntryId:manager.getLeafId()});
    const header = manager.getHeader()!;
    manager = SessionManager.inMemory(VIRTUAL_CWD,{id:input.demandId},[header,...manager.getEntries(),user]);
    let saved = savedHistoryLength;
    let liveHistory:readonly StoredEntry[]=input.history;
    let deliverCommunication!:(toolCallId:string,draft:Record<string,unknown>)=>Promise<CommunicationResult>;
    const allowedCaseIds=readCaseIds(input.history),documentReferences:string[]=[];
    const contextUsed=Math.ceil((Buffer.byteLength(JSON.stringify(input.history),'utf8')+Buffer.byteLength(SYSTEM_PROMPT,'utf8'))*0.625);
    const contextBudget=Math.max(0,Math.min(32000,this.model.contextWindow-this.model.maxTokens-4000-contextUsed));
    const customTools=input.policy.tools.size?createReceptionTools({documents:input.documents,check:input.check,signal:input.signal,trace:emit,allowedCaseIds,contextBudget,onDocumentRead:text=>{documentReferences.push(text);}}):[];
    if(input.policy.tools.has("read"))customTools.push(createApplicationSkillRead({check:input.check,signal:input.signal,trace:emit}));
    if(input.policy.tools.has("communicate"))customTools.push(createCommunicateTool((id,draft)=>deliverCommunication(id,draft)));
    const documentContext=await receptionDocumentContext(input.documents,input.history);
    const skills=prepareReceptionSkills(input.inputText,input.history,documentReferences);
    const requirements=prepareRequirementsDocument(input.history,input.inputMessageId,input.inputText);
    // An explicit document command selects a task, rather than hoping the model
    // elects to read its skill. Provision only this task's current application body;
    // never fabricate an assistant read call or persist synthetic native history.
    const requirementsSkillBody=requirements.request?applicationSkillText("requirements-document"):undefined;
    const requirementsTaskContext=requirementsSkillBody?`\n【当前明确任务：生成或修改需求文档】\nThe user explicitly requested a requirements document. The application has loaded the complete current requirements-document skill below. Follow it without another read. Plan and use tools as needed; intermediate communicate updates may continue work, but the final reply must deliver the complete report in the specified document format. A speech-only reply, offer, or claim of completion cannot complete this task.\n${requirementsSkillBody}\n`:"";
    if(requirementsSkillBody)await emit("task_skill_loaded",{task:"requirements-document",requestKind:requirements.request!.kind,source:"application-task-context",skillHash:createHash("sha256").update(requirementsSkillBody).digest("hex")});
    const effectiveSystemPrompt=SYSTEM_PROMPT + (customTools.length?receptionKnowledgeInstructions:"") + "\n" + skills.instructions;
    // Trusted, ephemeral run-start context. Never persisted as arbitrary system history.
    // New approved deliveries are appended as native communicate call/results.
    const dynamicContext=documentContext+receptionProgressContext(input.history,input.inputMessageId,input.inputText)+requirements.context+requirementsTaskContext;
    await emit("context_restored",{
      history:input.history.map(row=>{
        const e=row.entry as {type?:string;summary?:string;timestamp?:string;modelId?:string;provider?:string;message?:{role?:string;content?:unknown}};
        const identity={entryId:row.entryId,parentEntryId:row.parentEntryId,sequence:row.sequence,timestamp:e.timestamp};
        if(e.type!=="message"||!e.message)return {...identity,type:e.type,summary:e.summary,modelId:e.modelId,provider:e.provider};
        const content=e.message.content;
        const text=typeof content==="string"?content:Array.isArray(content)?content.filter(c=>c?.type==="text"&&typeof c.text==="string").map(c=>c.text).join(""):"";
        return {...identity,role:e.message.role,text};
      }),
      effectiveSystemPrompt,dynamicContext,dynamicContextPlacement:"after-history-before-current-user",promptHash:createHash("sha256").update(effectiveSystemPrompt).digest("hex"),
      toolDefinitions:customTools.map(({name,description,parameters})=>({name,description,parameters})),
      availableSkills:applicationSkills().skills.map(skill=>skill.name),caseIds:[...allowedCaseIds],sampleAvailable:!!skills.context.sample,
    });
    const { session } = await createAgentSession({cwd:VIRTUAL_CWD,agentDir:"/ally-ahead/disabled-config",
      modelRuntime:this.runtime,model:this.model,thinkingLevel:"off",scopedModels:[{model:this.model,thinkingLevel:"off"}],
      sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:false},
        retry:{enabled:false,maxRetries:0,provider:{maxRetries:0}},cacheWarming:"off",enableAnalytics:false,enableInstallTelemetry:false}),
      resourceLoader:receptionResources(input.policy.tools.has("read")?applicationSkills().skills:[]),tools:customTools.map(t=>t.name),noTools:"all",customTools });
    // The public streamFunction extension point guards every model round, including automatic ones.
    const originalStream = session.agent.streamFunction;
    let queue = Promise.resolve(); let failure: unknown; let pendingText = "";
    let requestNumber=0,requestStarted=0,firstTextAt:number|null=null,outputRecorded=false;
    let messageKey = `reply:${randomUUID()}`; let lastFlush = Date.now();
    let latestSnapshot:{key:string;text:string}|undefined;let snapshotQueued=false;
    const enqueue = (fn:()=>Promise<void>) => {
      queue = queue.then(async()=>{ if(failure) return; await fn(); }).catch(error=>{failure=error; void session.abort();});
    };
    let corrections=0, correctionFeedback="", approved:SessionEntry|undefined;
    let retainedReport:ReturnType<typeof assembleRequirementsDocument>;
    let expectedInteraction:string|undefined; // Current unapproved delivery only.
    let deliveryCount=0;
    const rejectedDraftIds=new Set<string>();
    const nativeCommunicationRejections=new Set<string>();
    let durableParent=input.history.at(-1)?.entryId??null;
    let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;void session.abort();},Math.max(1,this.correctionPolicy.totalTimeoutMs-(Date.now()-runtimeStarted)));
    deadline.unref();
    // The durable prefix may contain complete approved tool cycles, never a
    // malformed final draft. Persist tool pairs together before any next model call.
    const persist = async () => {
      const next=manager.getEntries();
      while(saved<next.length){
        const native=next[saved]!;
        if(native.type==="message"&&native.message.role==="system"){
          const message=native.message;
          const expected=customTools.map(({name,description,parameters})=>({name,description,parameters}));
          const declared=Array.isArray(message.toolsAdded)&&message.toolsAdded.every(tool=>expected.some(allowed=>isDeepStrictEqual(tool,allowed)))&&
            !message.toolsRemoved?.some(reference=>!customTools.some(tool=>tool.name===reference.name))&&
            Object.keys(message).every(key=>["role","content","timestamp","toolsAdded","toolsRemoved"].includes(key));
          const snapshot=isDeepStrictEqual(message.sections,{preamble:SYSTEM_PROMPT,...(input.policy.tools.has("read")?{skills:`<skills>\n${skills.instructions.trim()}\n</skills>`}:{}),cwd:`<cwd>\n${VIRTUAL_CWD}\n</cwd>`})&&
            Object.keys(message).every(key=>["role","content","timestamp","sections"].includes(key));
          if(message.content!==""||!Number.isFinite(message.timestamp)||(!declared&&!snapshot))throw new Error("UNAPPROVED_TOOL_DECLARATION");
          // Rebuild current tool declarations from the locked registry each run;
          // do not broaden durable history to arbitrary system instructions.
          await emit("tool_declaration_registered",{names:customTools.map(t=>t.name)});saved++;continue;
        }
        if(native.type==="message"&&native.message.role==="assistant"){
          const calls=native.message.content.filter(c=>c.type==="toolCall");
          if(!calls.length||native.message.stopReason!=="toolUse"){
            if(rejectedDraftIds.has(native.id)){saved++;continue;}
            break;
          }
          const results=next.slice(saved+1,saved+1+calls.length);
          if(results.length!==calls.length||!results.every((entry,i)=>entry.type==="message"&&entry.message.role==="toolResult"&&entry.message.toolCallId===calls[i]!.id))break;
          const group=[native,...results].map(entry=>captureEntry(entry,input.policy));
          // Validate linkage and resource-specific payloads before starting writes.
          let parent=durableParent;
          const entries=group.map(entry=>{const safe=captureEntry({...entry,parentId:parent},input.policy);parent=safe.id;return safe;});
          await input.check();
          const deliveries=entries.filter(entry=>communicatedPresentation(entry));
          if(deliveries.length&&!input.saveBatch)throw new Error("COMMUNICATE_MAPPING_REQUIRED");
          const mapped=input.saveBatch?await input.saveBatch(entries):undefined;
          if(!input.saveBatch)for(const entry of entries)await input.save(entry);
          if(mapped){
            validateHistory(mapped,input.policy);
            for(const entry of entries)if(!mapped.some(row=>row.entryId===entry.id&&isDeepStrictEqual(row.entry,entry)))throw new Error("COMMUNICATE_MAPPING_INVALID");
            liveHistory=mapped;
          }else if(deliveries.length)throw new Error("COMMUNICATE_MAPPING_REQUIRED");
          durableParent=parent;saved+=group.length;
          for(const delivery of deliveries){
            const presentation=communicatedPresentation(delivery)!;
            await emit("delivery_saved",{entryId:delivery.id,messageId:mapped!.find(row=>row.entryId===delivery.id)!.messageId,delivery:"intermediate",text:JSON.stringify(presentation)});
            if(presentation.progress)await emit("progress_notice_committed",{skill:"milestone-recording",entryId:delivery.id,delivery:"intermediate",notice:presentation.progress});
          }
          continue;
        }
        if(native.type==="message"&&native.message.role==="toolResult")throw new Error("ORPHAN_TOOL_RESULT");
        await input.check();const entry=captureEntry({...native,parentId:durableParent},input.policy);
        await input.save(entry);durableParent=entry.id;saved++;
      }
    };
    const correctionInstruction=(issue:string,delivery:"final"|"intermediate")=>{
      if(delivery==="final"&&requirements.request){
        if(retainedReport)return "The report is retained. Correct only the evidence selection. Return a JSON array of distinct integer ref values listed in userSources. No IDs, quotes, Markdown or surrounding text. Use [] only if there are no citable business facts.";
        return `The report failed validation: ${issue}. Preserve supported facts and complete the report. ${requirementsDocumentDelivery(requirements.english)}`;
      }
      return `The previous assistant draft failed validation: ${issue}. ${issue==="UNAPPROVED_CASE_REFERENCE"?"Call case_read to verify a valid relevant case before citing, or remove unsupported case claims and IDs. Tools remain available.":""} Repair the previous answer using the original user input and provided evidence. Preserve its meaning and deliverable; do not invent facts or quotes. ${expectedInteraction?`This reply declared interaction.type=${expectedInteraction}. Regenerate that complete component and validate its evidence; do not replace it with null or a different component. Rejected drafts are not approved content: never copy unsupported evidence.`:""} Speech and interaction must agree. Do not claim to show a card that is absent. If JSON syntax is wrong, repair the entire answer, not just its opening speech. Deliver one complete object with speech and interaction via communicate if continuing work, or as final JSON when stopping. No code fence or surrounding text. This is internal validation feedback, not a new user request.`;
    };
    const validateDelivery=async(raw:string,stopReason:string,delivery:"final"|"intermediate")=>{
      let value:unknown, reply="", issue="", compensation:string[]=[];
      // The explicit task's deliverable outranks an accidental model-declared
      // offer/choice card. Intermediate updates keep their existing contract.
      if(delivery==="final"&&requirements.request)expectedInteraction="requirements_document";
      expectedInteraction??=declaredReceptionInteraction(raw);
      try{
        if(stopReason==="length")throw new Error("OUTPUT_TRUNCATED: shorten the response and complete the delivery");
        const documentTask=delivery==="final"&&requirements.request;
        if(delivery==="final"&&!documentTask&&isRequirementsDocumentDraft(raw))
          throw Error("REQUIREMENTS_DOCUMENT_REQUEST_REQUIRED");
        const report=documentTask
          ? retainedReport
            ? {...retainedReport,interaction:{...retainedReport.interaction,evidence:requirements.resolveEvidence(parseRequirementsEvidenceRefs(raw))}}
            : assembleRequirementsDocument(raw,requirements.english,requirements.resolveEvidence)
          : undefined;
        const parsed=report
          ? {value:report,compensation:[retainedReport?"evidence_only_repair":"requirements_document_markdown_assembled"]}
          : parseReceptionOutput(raw);
        value=parsed.value;compensation=parsed.compensation;
        const localRepair=requirements.repairEvidence(value);
        value=localRepair.value;compensation.push(...localRepair.compensation);
        expectedInteraction??=declaredReceptionInteraction(raw,value);
        const issues=receptionOutputIssues(value);
        if(issues.length){
          if(report&&issues.every(path=>path.startsWith("interaction.evidence")))retainedReport=report;
          throw new Error(issues.join("; "));
        }
        if(documentTask)retainedReport=undefined;
        const candidate=ReceptionPresentation.parse(value);
        if(delivery==="final")requirements.validateFinal(candidate);
        const speechIssue=receptionSpeechQualityIssue(candidate.speech,input.inputText);
        if(speechIssue)throw new Error(speechIssue);
        if(expectedInteraction&&candidate.interaction?.type!==expectedInteraction)throw new Error(`RECEPTION_DELIVERY_MISSING:${expectedInteraction}`);
        const progress=sanitizeReceptionProgress(JSON.stringify(value),liveHistory,input.inputMessageId,input.inputText);
        if(progress.present)await emit("progress_notice_validated",{skill:"milestone-recording",requestNumber,passed:!progress.reason,reason:progress.reason,notice:progress.notice});
        reply=JSON.stringify(ReceptionPresentation.parse(JSON.parse(progress.text)));
        skills.validate(reply);
        let presentation=decodeReceptionPresentation(reply)!;
        presentation=requirements.normalize(presentation);
        if(presentation.interaction?.type==="requirements_document"){
          const body=applicationSkillText("requirements-document");
          const loaded=manager.getEntries().some(entry=>entry.type==="message"&&entry.message.role==="toolResult"&&entry.message.toolName==="read"&&!entry.message.isError&&entry.message.content.some(content=>content.type==="text"&&content.text===body));
          if(!requirementsSkillBody&&!loaded)throw new Error("REQUIREMENTS_DOCUMENT_SKILL_NOT_LOADED: read requirements-document/SKILL.md before generating the document");
          reply=JSON.stringify(presentation);
          await emit("requirements_document_validated",{requestNumber,replacesMessageId:presentation.interaction.replacesMessageId??null,evidenceMessageIds:presentation.interaction.evidence.map(item=>item.messageId)});
        }
        if(presentation.caseReferences?.some(id=>!allowedCaseIds.has(id)))throw new Error("UNAPPROVED_CASE_REFERENCE");
      }catch(error){issue=error instanceof SyntaxError?"INVALID_JSON_SYNTAX":error instanceof Error?error.message:"INVALID_RECEPTION_OUTPUT";}
      return {reply,issue,compensation};
    };
    const rejectCommunication=async(toolCallId:string,issue:string,executed:boolean):Promise<CommunicationResult>=>{
        if(issue==="REHEARSAL_INPUT_REQUIRED")expectedInteraction="sample_request";
        if(issue==="REQUIREMENTS_DOCUMENT_REQUEST_REQUIRED"||issue==="REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND")expectedInteraction=undefined;
        await emit("output_validation",{requestNumber,delivery:"intermediate",toolCallId,passed:false,issues:[issue],expectedInteraction:expectedInteraction??null});
        if(corrections>=this.correctionPolicy.maxCorrections||Date.now()-runtimeStarted>=this.correctionPolicy.totalTimeoutMs){
          await emit("output_correction_exhausted",{delivery:"intermediate",toolCallId,reason:issue,corrections});
          failure=new Error("OUTPUT_VALIDATION_FAILED");throw failure;
        }
        corrections++;correctionFeedback=correctionInstruction(issue,"intermediate")+(issue.startsWith("COMMUNICATE_ARGUMENTS_INVALID")?" Pass actual JSON values: interaction must be an object or null, progress if present an object, and caseReferences an array. Never JSON-stringify nested values.":"")+(issue==="COMMUNICATE_USE_FINAL_REPLY_FOR_USER_INPUT"?" Ask the question as the final reply and end this run, not through communicate.":"");
        await emit("output_correction",{requestNumber,delivery:"intermediate",toolCallId,correction:corrections,reason:issue,feedback:correctionFeedback});
        await input.snapshot(`repair:${deliveryCount}:${corrections}`,JSON.stringify({speech:/[\u3400-\u9fff]/u.test(input.inputText)?"这段内容还需要核对，我正在调整。":"I’m checking this part before sharing it.",interaction:null}));
        const result:CommunicationResult={status:"rejected",reason:correctionFeedback.slice(0,4000),remainingCorrections:this.correctionPolicy.maxCorrections-corrections,expectedInteraction:expectedInteraction??null};
        if(executed)await emit("tool_completed",{name:"communicate",toolCallId,result});return result;
    };
    const previousFinishTurn=session.agent.finishTurn;
    const validateTurn:NonNullable<typeof session.agent.finishTurn>=async(turn,signal)=>{
      await queue;if(failure)throw failure;
      await input.check();
      if(input.signal.aborted||signal?.aborted||timedOut)throw new Error(timedOut?"RUN_DEADLINE_EXCEEDED":"RUN_CANCELLED");
      if(turn.message.content.some(c=>c.type==="toolCall")){
        if(turn.message.stopReason!=="toolUse")throw new Error("INVALID_TOOL_TURN");
        for(const result of turn.toolResults){
          if(result.toolName!=="communicate"||!result.isError||nativeCommunicationRejections.has(result.toolCallId))continue;
          const call=turn.message.content.find(block=>block.type==="toolCall"&&block.id===result.toolCallId);
          if(!call||call.type!=="toolCall")throw new Error("INVALID_TOOL_TURN");
          expectedInteraction??=declaredReceptionInteraction(JSON.stringify(call.arguments),call.arguments);
          const issue=communicateArgumentIssue(call.arguments)??"COMMUNICATE_ARGUMENTS_REJECTED_BY_SDK";
          await rejectCommunication(result.toolCallId,issue,false);
          nativeCommunicationRejections.add(result.toolCallId);
        }
        await persist();await previousFinishTurn?.(turn,signal);return {action:"continue"};
      }
      if(turn.message.stopReason!=="stop"&&turn.message.stopReason!=="length")throw new Error("RUN_INCOMPLETE");
      const raw=turn.message.content.filter(c=>c.type==="text").map(c=>c.text).join("");
      const validated=await validateDelivery(raw,turn.message.stopReason,"final");
      let {reply,issue}=validated;const {compensation}=validated;
      await emit("output_validation",{requestNumber,passed:!issue,issues:issue?[issue]:[],compensation,expectedInteraction:expectedInteraction??null});
      if(issue!=="REHEARSAL_INPUT_REQUIRED")await emit("skill_validation",{requestNumber,passed:!issue,reason:issue||null});
      // Missing sample input has a deterministic, safe recovery: ask for it.
      // Other validation failures are returned to the Agent for correction.
      if(issue==="REQUIREMENTS_DOCUMENT_REQUEST_REQUIRED"||issue==="REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND"){
        const english=requirements.english,missing=issue==="REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND";
        reply=JSON.stringify({speech:missing?(english?"I couldn’t find that saved document in this conversation. Please open the document you want to revise first.":"当前会话里没有找到要修改的那份文档，请先打开对应文档再修改。"):(english?"We can keep discussing your needs. Generate the document when you explicitly choose to do so.":"可以继续补充需求；你明确选择生成时，我再整理成文档。"),interaction:missing?null:{type:"requirements_document_offer",title:english?"Requirements document":"需求文档",prompt:english?"Generate a document when you are ready, or keep discussing.":"准备好时可以生成需求文档，也可以继续沟通。"}});
        await emit("skill_recovery",{skill:"requirements-document",reason:issue,replacementText:reply});issue="";
      }
      if(issue==="REHEARSAL_INPUT_REQUIRED"){
        const recovered=skills.finalize(reply);
        reply=recovered.text;issue="";
        await emit("skill_validation",{passed:false,reason:recovered.reason});
        await emit("skill_recovery",{reason:recovered.reason,replacementText:reply});
      }
      if(issue){
        if(corrections<this.correctionPolicy.maxCorrections&&Date.now()-runtimeStarted<this.correctionPolicy.totalTimeoutMs){
          const rejected=manager.getEntries().findLast(entry=>entry.type==="message"&&entry.message.role==="assistant");
          if(rejected)rejectedDraftIds.add(rejected.id);
          corrections++;
          correctionFeedback=correctionInstruction(issue,"final");
          await emit("output_correction",{requestNumber,correction:corrections,reason:issue,feedback:correctionFeedback});
          const english=requirements.english;
          await input.snapshot(`repair:${deliveryCount}:${corrections}`,JSON.stringify({speech:english?(corrections===1?"The reply needs an adjustment. I’m working on it.":"I’m checking the reply again. One moment."):(corrections===1?"刚才的回复有些问题，我正在调整。":"还需要核对一下，稍等。"),interaction:null}));
          await previousFinishTurn?.(turn,signal);
          return {action:"continue"};
        }
        // Exhaustion is a failed run, not a successful speech-only substitute.
        // Existing job/HTTP failure handling preserves input and exposes retry.
        await emit("output_correction_exhausted",{reason:issue,corrections,expectedInteraction:expectedInteraction??null});
        throw new Error(issue==="UNAPPROVED_CASE_REFERENCE"?issue:"OUTPUT_VALIDATION_FAILED");
      }
      // Optional achievement metadata cannot break a usable business reply.
      reply=sanitizeReceptionProgress(reply,liveHistory,input.inputMessageId,input.inputText).text;
      if(decodeReceptionPresentation(reply)?.caseReferences?.some(id=>!allowedCaseIds.has(id)))throw new Error("UNAPPROVED_CASE_REFERENCE");
      const native=manager.getEntries().findLast(e=>e.type==="message"&&e.message.role==="assistant");
      if(!native||native.type!=="message"||native.message.role!=="assistant")throw new Error("RUN_INCOMPLETE");
      approved=captureEntry({...native,parentId:durableParent,message:{...native.message,content:[{type:"text",text:reply}]}},input.policy);
      await emit("case_validation",{passed:true,caseReferences:decodeReceptionPresentation(reply)?.caseReferences??[]});
      if(compensation.length)await emit("output_compensation",{compensation,text:reply});
      await previousFinishTurn?.(turn,signal);
      return {action:"end"};
    };
    deliverCommunication=async(toolCallId,draft)=>{
      await queue;if(failure)throw failure;await input.check();input.signal.throwIfAborted();
      await emit("tool_started",{toolCallId,name:"communicate",arguments:draft});
      const validated=await validateDelivery(JSON.stringify(draft),"stop","intermediate");
      let issue=validated.issue;
      const presentation=!issue?decodeReceptionPresentation(validated.reply):null;
      if(presentation&&!issue)issue=communicationHandoffIssue(presentation.speech)??"";
      if(presentation?.interaction&&["single_choice","multiple_choice","sample_request","demand_review","requirements_document_offer","requirements_document"].includes(presentation.interaction.type))issue="COMMUNICATE_USE_FINAL_REPLY_FOR_USER_INPUT";
      if(issue)return rejectCommunication(toolCallId,issue,true);
      if(deliveryCount>=6){failure=new Error("COMMUNICATE_DELIVERY_LIMIT");throw failure;}
      const result:CommunicationResult={status:"delivered",presentation:presentation!};
      await emit("output_validation",{requestNumber,delivery:"intermediate",toolCallId,passed:true,issues:[]});
      await emit("skill_validation",{requestNumber,delivery:"intermediate",passed:true,reason:null});
      await emit("case_validation",{delivery:"intermediate",passed:true,caseReferences:presentation!.caseReferences??[]});
      await emit("tool_completed",{name:"communicate",toolCallId,result});
      deliveryCount++;expectedInteraction=undefined;corrections=0;correctionFeedback="";
      // This receipt is not public until persist() atomically saves its native
      // call/result pair and obtains the real message mapping from the adapter.
      return result;
    };
    session.agent.finishTurn=async(turn,signal)=>{
      try{const decision=await validateTurn(turn,signal);return decision || undefined;}catch(error){failure=error;throw error;}
    };
    session.agent.streamFunction = async(model,context,options) => {
      await queue;
      if(failure) throw failure;
      await persist(); await input.check();
      if(input.signal.aborted||timedOut) throw new Error(timedOut?"RUN_DEADLINE_EXCEEDED":"RUN_CANCELLED");
      if(requestNumber>=20)throw new Error("MODEL_ROUND_LIMIT");
      requestNumber++;requestStarted=Date.now();firstTextAt=null;outputRecorded=false;
      const requestSystemPrompt=effectiveSystemPrompt;
      await emit("model_started",{requestNumber,provider:model.provider,modelId:model.id,api:model.api,
        maxOutputTokens:model.maxTokens,contextWindow:model.contextWindow,historyMessageCount:context.messages.length,
        promptHash:createHash("sha256").update(requestSystemPrompt).digest("hex"),correctionFeedback,tools:customTools.map(t=>t.name),automaticRetries:0,correction:corrections});
      // Conservative multilingual estimate plus explicit output/headroom reserve;
      // document payload allocation separately uses a stricter byte ceiling.
      const messages=context.messages.filter(message=>message.role!=="system").map(message=>{
        // Older document payloads remain in protected history/trace, but do not
        // silently re-enter a model request without current resource authority.
        if(message.role==="toolResult"&&message.toolName.startsWith("document_")&&
          input.history.some(row=>{const e=row.entry as {type?:string;message?:{toolCallId?:string}};return e.type==="message"&&e.message?.toolCallId===message.toolCallId;}))
          return {...message,content:[{type:"text" as const,text:JSON.stringify({note:"Historical document result omitted; use current authorized document tools to read needed material again."})}]};
        return message;
      });
      const currentUserIndex=messages.findLastIndex(message=>message.role==="user");
      if(currentUserIndex<0)throw new Error("RUN_INCOMPLETE");
      const outgoing:typeof context={...context,messages:[
        {role:"system",content:requestSystemPrompt,timestamp:0,toolsAdded:customTools.map(({name,description,parameters})=>({name,description,parameters}))},
        ...messages.slice(0,currentUserIndex),
        {role:"system",content:dynamicContext,timestamp:0},
        ...messages.slice(currentUserIndex),
        ...(deliveryCount?[{role:"system" as const,content:deliveredContinuationInstruction,timestamp:0}]:[]),
        ...(requirements.request?[{role:"system" as const,content:retainedReport
          ?"The report is retained. Reply only with the corrected source-reference array."
          :requirementsDocumentDelivery(requirements.english),timestamp:0}]:[]),
        ...(correctionFeedback?[{role:"system" as const,content:correctionFeedback,timestamp:0}]:[]),
      ]};
      if(Math.ceil(Buffer.byteLength(JSON.stringify(outgoing.messages),"utf8")*0.625)+model.maxTokens+2000>model.contextWindow)throw new Error("MODEL_CONTEXT_BUDGET_EXCEEDED");
      const declarations=outgoing.messages.flatMap(message=>message.role==="system"?message.toolsAdded??[]:[]);
      await emit("model_request_context",{requestNumber,
        toolDeclarations:declarations.map(tool=>({name:tool.name,definitionHash:createHash("sha256").update(JSON.stringify(tool)).digest("hex")})),
        messages:outgoing.messages.map(message=>message.role==="assistant"?{...message,content:message.content.filter(block=>block.type!=="thinking")}:message)});
      return originalStream(model,outgoing,{...options,maxRetries:0});
    };
    session.agent.beforeToolCall = async context=>{
      await input.check();input.signal.throwIfAborted();
      if(failure)throw failure;
      const calls=context.assistantMessage.content.filter(block=>block.type==="toolCall");
      if(calls.some(call=>call.name==="communicate")&&calls.length!==1){failure=new Error("COMMUNICATE_REQUIRES_SINGLE_TOOL_CALL");throw failure;}
      if(context.toolCall.name==="communicate"){
        // Inspect the original values, not potentially coerced SDK args.
        const issue=communicateArgumentIssue(context.toolCall.arguments);
        if(issue){
          expectedInteraction??=declaredReceptionInteraction(JSON.stringify(context.toolCall.arguments),context.toolCall.arguments);
          const result=await rejectCommunication(context.toolCall.id,issue,false);
          nativeCommunicationRejections.add(context.toolCall.id);
          return {block:true,reason:result.status==="rejected"?result.reason:issue};
        }
      }
      if(!customTools.some(tool=>tool.name===context.toolCall.name)){
        await emit("tool_blocked",{name:context.toolCall.name,toolCallId:context.toolCall.id,reason:"TOOL_NOT_ALLOWED"});
        return {block:true,reason:"TOOL_NOT_ALLOWED"};
      }
      input.policy.tools.get(context.toolCall.name)!.arguments.parse(context.toolCall.arguments);
      return undefined;
    };
    const abort = ()=>{ void session.abort(); };
    input.signal.addEventListener("abort",abort,{once:true});
    const unsubscribe = session.subscribe(event=>{
      if(event.type === "message_start" && event.message.role === "assistant") { pendingText="";messageKey=`reply:${randomUUID()}`; }
      if(event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        if(firstTextAt===null)firstTextAt=Date.now();
        pendingText += event.assistantMessageEvent.delta;
        // This is a bounded cumulative slot, never a durable per-token event log.
        if(Buffer.byteLength(pendingText,"utf8") > 240000) {failure=new Error("SNAPSHOT_LIMIT");void session.abort();return;}
        if(!requirements.request&&!corrections&&Date.now()-lastFlush >= this.snapshotIntervalMs&&Buffer.byteLength(JSON.stringify({messageKey,text:pendingText,progress:"responding"}),"utf8")+64<=32768) {
          latestSnapshot={text:pendingText,key:messageKey};
          if(!snapshotQueued) {
            snapshotQueued=true;lastFlush=Date.now();
            enqueue(async()=>{
              const current=latestSnapshot;latestSnapshot=undefined;
              try {if(current){await input.check();assertSafeText(current.text);await input.snapshot(current.key,current.text);}}
              finally {snapshotQueued=false;}
            });
          }
        }
      }
      if(event.type==="message_end"&&event.message.role==="assistant"){
        const message=event.message;
        const text=message.content.filter(c=>c.type==="text").map(c=>c.text).join("");
        const usage={input:message.usage.input,output:message.usage.output,cacheRead:message.usage.cacheRead,
          cacheWrite:message.usage.cacheWrite,totalTokens:message.usage.totalTokens,cost:{...message.usage.cost}};
        const durationMs=Date.now()-requestStarted;
        enqueue(async()=>{
          await emit("model_output",{requestNumber,text,complete:message.stopReason==="stop"||message.stopReason==="toolUse",stopReason:message.stopReason,
            usage,costBasis:"configured_rates_not_provider_billing",durationMs,timeToFirstTextMs:firstTextAt===null?null:firstTextAt-requestStarted,
            requestedTools:message.content.filter(c=>c.type==="toolCall").map(c=>({id:c.id,name:c.name,arguments:c.arguments}))});
          outputRecorded=true;
        });
      }
      // SDK appends message_end to the manager after synchronous listeners return.
      // Promise queue reads the completed canonical entry on the next microtask.
      // Only finishTurn may approve an assistant entry; message_end records trace only.
    });
    try {
      await input.check();
      if(input.signal.aborted) throw new Error("RUN_CANCELLED");
      await persist();
      // Public SDK continuation preserves our canonical original-message timestamp and id.
      await session.agent.continue();
      await queue;
      if(failure) throw failure;
      if(input.signal.aborted) throw new Error("RUN_CANCELLED");
      await persist(); await input.check();
      if(timedOut)throw new Error("RUN_DEADLINE_EXCEEDED");
      if(!approved)throw new Error("RUN_INCOMPLETE");
      await input.save(approved);
      if(approved.type==="message"&&approved.message.role==="assistant")await emit("assistant_saved",{
        entryId:approved.id,text:approved.message.content.filter(c=>c.type==="text").map(c=>c.text).join(""),
        interactionType:decodeReceptionPresentation(approved.message.content.filter(c=>c.type==="text").map(c=>c.text).join(""))?.interaction?.type??null,
      });
      if(approved.type==="message"&&approved.message.role==="assistant"){
        const progress=decodeReceptionPresentation(approved.message.content.filter(c=>c.type==="text").map(c=>c.text).join(""))?.progress;
        if(progress)await emit("progress_notice_committed",{skill:"milestone-recording",entryId:approved.id,notice:progress});
      }
      await emit("runtime_completed",{durationMs:Date.now()-runtimeStarted,modelRequests:requestNumber});
    } catch(error){
      try{
        if(requestNumber&&!outputRecorded)await emit("model_output",{requestNumber,text:pendingText,complete:false,stopReason:input.signal.aborted?"aborted":"incomplete",usage:null,durationMs:Date.now()-requestStarted});
      }catch{/* The durable job terminal event/exporter must mark missing runtime events incomplete. */}
      throw error;
    } finally { clearTimeout(deadline);input.signal.removeEventListener("abort",abort);unsubscribe();await session.abort();session.dispose(); }
  }
}
