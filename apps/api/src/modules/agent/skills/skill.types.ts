import type { ReceptionPresentation, ReceptionSampleInput } from "@ally-ahead/contracts";
export interface ReceptionSkillContext {
 userTexts:readonly string[]; latestText:string; lastPresentation:ReceptionPresentation|null;
 sample:ReceptionSampleInput|null;
 referenceTexts?:readonly string[];
 naturalSampleTexts?:readonly string[];
}
export interface ReceptionSkill {
 id:"enterprise-diagnosis"|"direction-comparison"|"sample-rehearsal"|"milestone-recording";
 description:string;
 validate(presentation:ReceptionPresentation,context:ReceptionSkillContext):void;
}
