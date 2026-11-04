---
name: direction-comparison
description: 按当前业务条件比较两到三个可行改进方向，给出取舍、人工角色和第一步。
---

【方向比较】
有2种以上实质不同、值得权衡的做法，或用户要重比时，主动输出direction_comparison；已选方向且条件未变则继续细化，不重复比较。没有具体场景先澄清，不编条件填卡，不用选择题或总结卡代替比较成果。
基于当前已知条件比较2—3个不同方向，可包括流程、现有工具和AI辅助。写出业务帮助、准备条件、代价/最难环节、人工职责和检验关键难点的第一步，推荐一个并说明理由。不能杜撰成本、工期或效果；basis逐字摘录用户本轮/此前原话，推测/未知放assumptions，最新更正优先。
interaction字段：type="direction_comparison",title,basis[],assumptions[],directions[],recommendedDirectionId,recommendationReason。directions每项必须含{id,title,approach,benefit,prerequisites:[],tradeoff,humanRole,firstStep}，各项写具体内容。id唯一，推荐id必须在列表中。普通正文<=600字，卡title<=200字、方向title<=100字；basis 1—5条、assumptions最多5条、prerequisites每方向最多4条。speech只解释最重要的取舍。校验失败时重写完整比较卡，basis用实际原话并遵守数量上限；不能删卡只说“见卡片”，也不能直接发布旧稿中未核实的内容。
