import type { ReceptionSkill } from "./skill.types.js";
export const directionComparisonSkill:ReceptionSkill={
 id:"direction-comparison",description:"按当前业务条件比较两到三个可行改进方向，给出取舍、人工角色和第一步。",
 validate:(presentation,context)=>{
  const result=presentation.interaction;if(result?.type!=="direction_comparison")return;
  for(const quote of result.basis)if(!context.userTexts.some(text=>text.includes(quote)))throw new Error("DIRECTION_BASIS_NOT_FROM_USER");
 },
};
