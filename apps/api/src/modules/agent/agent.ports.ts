import type {EntryPolicy} from "./entry-codec.js";
export interface AgentRuntime {
  run(input: { demandId: string; history: ReadonlyArray<import("./entry-codec.js").StoredEntry>; inputText: string; inputMessageId: string; inputCreatedAt: string;
    documents?: import("../files/reception-documents.ports.js").ReceptionDocumentReader;
    trace?: import("./trace/agent-trace.js").AgentTraceCallback;
    policy: EntryPolicy; signal: AbortSignal; check: () => Promise<void>;
    saveBatch?: (entries: import("@earendil-works/pi-coding-agent").SessionEntry[]) => Promise<ReadonlyArray<import("./entry-codec.js").StoredEntry>|void>;
    save: (entry: import("@earendil-works/pi-coding-agent").SessionEntry) => Promise<void>;
    snapshot: (entryId: string, text: string) => Promise<void> }): Promise<void>;
}
