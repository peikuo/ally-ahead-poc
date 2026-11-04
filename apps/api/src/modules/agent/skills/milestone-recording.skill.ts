import type { ReceptionSkill } from "./skill.types.js";

export const milestoneRecordingSkill: ReceptionSkill = {
 id:"milestone-recording",
 description:"当用户明确业务选择、范围或约束，或更正已有结论时，主动记录有用户原话依据的小目标；不等整套方案完成，不记计划或纯建议。",
 // Notification checks are independent of speech/card validation and never
 // trigger a second model call for a metadata-only issue.
 validate:()=>{},
};
