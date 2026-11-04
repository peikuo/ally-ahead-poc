import type { Copy, Locale } from "./content";

// Keep the existing visual story; describe only the available POC experience.
export const pocMessages: Record<Locale, Partial<Copy>> = {
  zh: {
    heroDetail:
      "与 AI 接待交流，整理完整需求文档。本次仅演示 USD 500 Sandbox 测试付款与模拟发布，无真实收费。",
    clarifyDetail:
      "AI 帮你整理现状、目标与约束，修改并下载完整 Markdown 需求文档。",
    compare: "比较可行方向，<br>找到你的起点。",
    compareDetail:
      "对照不同做法，讨论适用条件和人工复核范围。本次不开放专家提案与选择。",
    agree: "核对需求，<br>明确下一步。",
    agreeDetail:
      "独立认可当前文档后，可另选 Sandbox 测试付款与模拟发布；签约和后续协作暂未开放。",
    success: "从清晰需求，<br>走向 AI 应用。",
    successDetail:
      "展示 AI 进入业务的愿景。本次 POC 到模拟发布和主动全额退款为止，不代表签约或开工。",
    sceneCompare: "比较可行方向",
    sceneAgree: "核对需求",
    sceneSuccess: "走向 AI 应用",
    qProposals: "这次可以体验哪些流程？",
    aProposals:
      "无需登录，先和 AI 接待讨论需求，生成、修改和下载完整文档；独立认可后，可另选 USD 500 PayPal Sandbox 测试付款与模拟发布，再主动申请测试全额退款。",
    qChoice: "需要注册账号或选择专家吗？",
    aChoice: "本次直接以访客开始。账号、专家选择、签约与后续协作尚未开放。",
    qPrivate: "交流和上传资料时要注意什么？",
    aPrivate:
      "请使用非机密、已脱敏的内容。可以概括业务情况，也可以上传资料辅助本次需求讨论。",
    qDelivery: "付款会产生真实收费吗？",
    aDelivery:
      "不会。本次是 USD 500 PayPal Sandbox 测试资金演示，发布也是模拟；不代表已签约或开工。测试退款需主动申请，不会自动退款。",
  },
  en: {
    heroDetail:
      "Discuss your needs with AI reception and prepare a full requirements document. This POC demonstrates USD 500 Sandbox test payment and simulated publication, with no real charge.",
    clarifyDetail:
      "Clarify the context, goals and constraints. Revise and download a complete Markdown requirements document.",
    compare: "Compare approaches.<br>Find your starting point.",
    compareDetail:
      "Discuss suitable approaches and human review. Expert proposals and selection are not available in this POC.",
    agree: "Review your need.<br>Clarify what’s next.",
    agreeDetail:
      "Confirm the document separately, then choose Sandbox test payment and simulated publication. Contracts and collaboration are not available yet.",
    success: "A clearer need.<br>A path to AI.",
    successDetail:
      "A vision of AI in everyday work. This POC ends at simulated publication and a user-requested full test refund, without a contract or project start.",
    sceneCompare: "Compare approaches",
    sceneAgree: "Review your need",
    sceneSuccess: "A path to AI",
    qProposals: "What can I try in this POC?",
    aProposals:
      "Start as a guest, discuss your need, and generate, revise and download a full document. After a separate confirmation, choose USD 500 PayPal Sandbox test payment and simulated publication, then request a full test refund.",
    qChoice: "Do I need an account or an expert?",
    aChoice:
      "Start directly as a guest. Accounts, expert selection, contracts and collaboration are not available in this POC.",
    qPrivate: "What should I share or upload?",
    aPrivate:
      "Use non-confidential, anonymized content. Describe the business in general terms or upload suitable material to support this discussion.",
    qDelivery: "Will the payment charge real money?",
    aDelivery:
      "No. This is a USD 500 PayPal Sandbox test-funds demonstration with simulated publication. It does not mean a contract or project has started. Full test refunds require your explicit request.",
  },
};
