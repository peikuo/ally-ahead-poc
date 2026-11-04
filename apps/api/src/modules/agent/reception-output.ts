import { ReceptionPresentation, ReceptionInteraction } from "@ally-ahead/contracts";

// One observed schema-neutral error, not a general unknown-field cleaner.
// An absent root reference list and an empty misplaced list contain no citations
// to reinterpret. Every remaining field still goes through all normal guards.
function removeEmptyMisplacedReferences(value:unknown,compensation:string[]):unknown {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.hasOwn(value,"caseReferences"))return value;
  const root=value as Record<string,unknown>,card=root.interaction;
  if(!card||typeof card!=="object"||Array.isArray(card))return value;
  const fields=card as Record<string,unknown>;
  if(fields.type!=="demand_review"||!Object.hasOwn(fields,"caseReferences")||!Array.isArray(fields.caseReferences)||fields.caseReferences.length!==0)return value;
  const {caseReferences:emptyReferences,...interaction}=fields;
  compensation.push("empty_misplaced_case_references_removed");
  return {...root,interaction};
}

// Only repair syntax with an unambiguous interpretation. Never invent missing
// quotes, values, business facts or source evidence.
export function parseReceptionOutput(text: string): { value: unknown; compensation: string[] } {
  let source = text.trim();
  const compensation: string[] = [];
  if (/^```(?:json)?\s*[\s\S]*\s*```$/i.test(source)) {
    source = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    compensation.push("code_fence_removed");
  }
  try { return { value: removeEmptyMisplacedReferences(JSON.parse(source),compensation), compensation }; } catch {}
  // Plain conversational text can be transported without asking the model to
  // repeat it. Protocol-looking or truncated objects must go through correction.
  if (source && !/^[{\["`]/.test(source) && !/"(?:speech|interaction)"\s*:/.test(source))
    return { value: { speech: source, interaction: null }, compensation: [...compensation, "plain_text_wrapped"] };
  let normalized = "", inString = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (inString) {
      if (escaped) { normalized += c; escaped = false; continue; }
      if (c === "\\") { escaped = true; normalized += c; continue; }
      if (c === '"') inString = false;
      normalized += c.charCodeAt(0) < 32 ? JSON.stringify(c).slice(1, -1) : c;
    } else {
      if (c === '"') inString = true;
      if (c === "," && /^\s*[}\]]/.test(source.slice(i + 1))) continue;
      normalized += c;
    }
  }
  const value: unknown = JSON.parse(normalized);
  compensation.push("json_syntax_normalized");
  return { value:removeEmptyMisplacedReferences(value,compensation), compensation };
}

export function receptionOutputIssues(value: unknown): string[] {
  const parsed = ReceptionPresentation.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.slice(0, 10).map(issue =>
    `${issue.path.join(".") || "reply"}: ${issue.message}`);
}

// A draft is untrusted. Remember only its declared component type, never its
// content, so a later repair cannot silently discard the promised deliverable.
// This hint can only tighten validation; it cannot authorize a rejected card.
export function declaredReceptionInteraction(raw:string,value?:unknown):string|undefined {
  if(value&&typeof value==='object'&&'interaction' in value){
    const interaction=value.interaction;
    if(interaction&&typeof interaction==='object'&&'type' in interaction&&typeof interaction.type==='string'&&ReceptionInteraction.options.some(option=>option.shape.type.value===interaction.type))return interaction.type;
    return undefined;
  }
  // A syntax-broken speech string may precede a well-formed component header.
  // Do not repair/parse its contents. Only accept one unambiguous known header;
  // escaped JSON quoted within a valid speech string does not match this header.
  const source=raw.trim().replace(/^```(?:json)?\s*/i,'');
  if(!source.startsWith('{'))return undefined;
  const headers=[...source.matchAll(/"interaction"\s*:\s*\{\s*"type"\s*:\s*"([a-z_]+)"/g)];
  const type=headers.length===1?headers[0]![1]:undefined;
  return type&&ReceptionInteraction.options.some(option=>option.shape.type.value===type)?type:undefined;
}
