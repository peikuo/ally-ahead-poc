// Curated POC subset: original factual summaries; see docs/CASE_SOURCES.md.
export const externalCases = [
  {
    "id": "EAI-001",
    "company": "51社保",
    "region": "中国",
    "industry": "企业人力资源服务",
    "businessFunction": "财务单据处理",
    "tags": [
      "发票",
      "清账",
      "OCR",
      "数据比对",
      "财务与税务"
    ],
    "issueDimensions": [
      "财务单据",
      "字段识别",
      "业务比对",
      "异常处理"
    ],
    "businessBackground": "51社保为企业提供人力资源服务，需要处理业务往来产生的机打发票与清账。",
    "problem": "发票信息依靠人工提取并与业务数据比对，清账耗时且易出错。",
    "aiRole": "识别机打发票的指定字段；识别结果与业务数据匹配后用于自动核销。",
    "workflowDetail": "扫描纸质发票后，识别发票号码等字段，再与开票业务信息比对；匹配成功才自动核销。未披露异常比例。",
    "implementation": {
      "disclosure": "limited",
      "challenges": [],
      "process": [
        "扫描纸质发票，按模板提取9类字段，与业务开票信息比对，匹配成功后自动核销。",
        "扫描纸质发票，将其转为电子图像。",
        "使用定制 iOCR 模板提取发票代码、号码等九类信息。",
        "将提取信息与业务开票数据比对；匹配成功后自动核销。"
      ],
      "evidence_gap": "来源说明扫描、模板提取、比对和核销步骤，但未明确披露具体项目实施难点与完整成本。",
      "solution_details": {
        "data": "每月数万张机打发票及开票业务数据，提取发票代码、号码、收款方识别号等9类信息；样本和错误率未披露。",
        "tools": "百度 iOCR 自定义模板文字识别、高速扫描仪及财务处理平台。",
        "roles": "财务人员原负责录入与比对；方案开发、异常核对和最终财务审批岗位未披露。",
        "evaluation": "百度称每张由1分钟缩至3秒以内；统计样本、异常处理时间和计量方法未披露。"
      }
    },
    "result": "百度称每月处理数万张机打发票，单张处理时间由1分钟缩短到3秒以内，效率提升20倍以上。",
    "resultLimitations": "未披露统计周期、异常处理比例或准确率；结果涉及识别与匹配流程。",
    "citationPolicy": "可介绍业务过程；引用数字须注明百度口径及处理范围，不推断其他票种的效果。",
    "questions": [
      "目前主要处理哪些类型的发票，每月大约多少张？",
      "现在从收到发票到核销，哪一步最费时间？",
      "遇到信息不匹配或无法识别的票据时，通常怎么处理？"
    ],
    "sources": [
      {
        "title": "百度智能云：51社保 iOCR 案例",
        "url": "https://cloud.baidu.com/aicustomer/51shebao",
        "type": "供应商客户案例",
        "publishedAt": null,
        "accessedAt": "2026-11-01"
      }
    ],
    "matchSummary": "任务与痛点：发票信息依靠人工提取并与业务数据比对，清账耗时且易出错。AI介入：识别机打发票的指定字段；识别结果与业务数据匹配后用于自动核销。公开数据条件：每月数万张机打发票及开票业务数据，提取发票代码、号码、收款方识别号等9类信息；样本和错误率未披露。效果与来源：百度称每月处理数万张机打发票，单张处理时间由1分钟缩短到3秒以内，效率提升20倍以上（供应商披露）。限制：未披露统计周期、异常处理比例或准确率；结果涉及识别与匹配流程。"
  },
  {
    "id": "EAI-006",
    "company": "Danfoss",
    "region": "丹麦",
    "industry": "工业制造",
    "businessFunction": "订单处理",
    "tags": [
      "B2B",
      "邮件",
      "订单",
      "报价",
      "物流与供应链"
    ],
    "issueDimensions": [
      "订单处理",
      "销售支持",
      "系统衔接",
      "人工复核"
    ],
    "businessBackground": "丹麦工业制造商Danfoss面向不同企业客户销售设备，一部分复杂订单通过邮件和附件进入。",
    "problem": "客户邮件中含复杂订单和附件，人员需要跨多个系统录入处理。",
    "aiRole": "理解邮件及附件中的订单或报价请求，对接企业系统；需要判断时由人介入。",
    "workflowDetail": "模型处理邮件中的订单或报价请求并连接ERP/CRM；需要人做决定时仍需介入。每单约五分钟为企业估计。",
    "implementation": {
      "disclosure": "source_described",
      "challenges": [
        "客户邮件混有自由文本、表格及PDF、图片、表格等不同附件。",
        "订单可能缺少零件号或存在价格不一致，需要结合企业业务流程处理。"
      ],
      "process": [
        "与Go Autonomous配置订单处理平台，建立ERP和CRM连接。",
        "解析邮件中的订单或报价并触发相应业务操作；需人工决定的情形交人员处理。"
      ],
      "evidence_gap": "异常处理覆盖率、投入和每项决定的测量口径未披露。",
      "solution_details": {
        "data": "客户 B2B 订单与询价邮件、ERP 和 CRM 业务数据；平台模型使用全球数百万 B2B 交易训练，Danfoss 专属训练样本及授权范围未披露。",
        "tools": "Go Autonomous 的 Autonomous Commerce、Google Kubernetes Engine，以及 ERP、CRM 连接器；具体模型和版本未披露。",
        "roles": "Danfoss 与 Go Autonomous 联合配置业务流程和连接器；销售及客服处理需要人判断的事项，具体审核权限未披露。",
        "evaluation": "企业估计平均每单省约 5 分钟，负责人称相关决策超 80% 由 AI 作出；一单完全自动化比例、样本和观察期未披露，一分钟确认是未来目标。"
      }
    },
    "result": "Google Cloud援引企业负责人估计每单平均节省约5分钟，超过80%的相关决策由AI作出。",
    "resultLimitations": "80%指相关决策而非完整订单自动完成率；一分钟内确认订单是未来目标。",
    "citationPolicy": "可介绍邮件订单处理过程；时间标注为估计，勿将未来目标说成已实现。",
    "questions": [
      "客户通常通过什么方式发送订单，附件有哪些格式？",
      "订单录入时常缺哪些信息或出现哪些例外？",
      "目前订单需要经过哪些系统和人员？"
    ],
    "sources": [
      {
        "title": "Google Cloud：Danfoss 订单处理案例",
        "url": "https://cloud.google.com/customers/danfoss",
        "type": "供应商客户案例，含企业负责人描述",
        "publishedAt": null,
        "accessedAt": "2026-11-02"
      }
    ],
    "matchSummary": "任务与痛点：客户邮件中含复杂订单和附件，人员需要跨多个系统录入处理。AI介入：理解邮件及附件中的订单或报价请求，对接企业系统；需要判断时由人介入。公开数据条件：客户 B2B 订单与询价邮件、ERP 和 CRM 业务数据；平台模型使用全球数百万 B2B 交易训练，Danfoss 专属训练样本及授权范围未披露。效果与来源：Google Cloud援引企业负责人估计每单平均节省约5分钟，超过80%的相关决策由AI作出（供应商案例中的企业估计）。限制：80%指相关决策而非完整订单自动完成率；一分钟内确认订单是未来目标。"
  },
  {
    "id": "EAI-008",
    "company": "C.H. Robinson",
    "region": "美国",
    "industry": "物流",
    "businessFunction": "运输请求处理",
    "tags": [
      "物流",
      "邮件",
      "运输请求",
      "客户服务",
      "物流与供应链"
    ],
    "issueDimensions": [],
    "businessBackground": "美国物流企业C.H. Robinson每天通过邮件接收大量客户运输请求，员工此前需逐项处理。",
    "problem": "大量客户运输请求通过邮件送达，等待员工处理可能需要数小时。",
    "aiRole": "理解邮件中的运输请求，并辅助自动处理相关工作流。",
    "workflowDetail": "生成式AI理解邮件中的特定运输请求并触发相应流程；并非所有运输任务或例外情况都能自动完成。",
    "implementation": {
      "disclosure": "source_described",
      "challenges": [
        "不同客户的运输流程各不相同，需要把员工掌握的客户专属流程转化为可供系统使用的知识。"
      ],
      "process": [
        "整理客户差异及业务知识；自动识别邮件、组合请求细节、查找缺失信息并执行运输请求相关步骤；纳入人工反馈，覆盖多个货运环节。"
      ],
      "evidence_gap": "公开资料未完整披露项目成本、全部测试方法及后续运行情况；不将未披露细节视为已实施。",
      "solution_details": {
        "data": "客户货运请求邮件、客户专属业务知识和现有业务数据；样本、字段及训练集未披露。",
        "tools": "Azure AI Foundry、Azure OpenAI、GitHub、Azure SQL Database、Azure Cosmos DB；模型版本未披露。",
        "roles": "C.H. Robinson AI、战略创新与客户经理参与案例；来源称存在人工反馈环，但未公布每类请求的审批岗位与责任分工。",
        "evaluation": "微软案例引用客户经理：邮件报价从数小时缩至平均32秒；适用具体报价流程，样本期间、异常处理比例和独立评估未披露。"
      }
    },
    "result": "微软称相关请求处理速度由数小时缩短至数秒。",
    "resultLimitations": "未明确完整分母与异常人工处理比例，不代表所有运输请求都能自动完成。",
    "citationPolicy": "可描述邮件请求处理；引用时间应限定相关请求并标明微软来源。",
    "questions": [
      "客户最常通过邮件提出哪些运输请求？",
      "工作人员通常需要查看哪些信息才能处理？",
      "哪些请求需要人工判断或协调？"
    ],
    "sources": [
      {
        "title": "微软：C.H. Robinson 物流邮件自动化",
        "url": "https://www.microsoft.com/en/customers/story/19575-ch-robinson-azure-ai-studio",
        "type": "供应商客户案例",
        "publishedAt": "2024-11-11",
        "accessedAt": "2026-11-01"
      }
    ],
    "matchSummary": "任务与痛点：大量客户运输请求通过邮件送达，等待员工处理可能需要数小时。AI介入：理解邮件中的运输请求，并辅助自动处理相关工作流。公开数据条件：客户货运请求邮件、客户专属业务知识和现有业务数据；样本、字段及训练集未披露。效果与来源：微软称相关请求处理速度由数小时缩短至数秒（供应商披露）。限制：未明确完整分母与异常人工处理比例，不代表所有运输请求都能自动完成。"
  },
  {
    "id": "EAI-048",
    "company": "Best Buy",
    "region": "美国",
    "industry": "零售",
    "businessFunction": "客户支持",
    "tags": [
      "客服",
      "知识",
      "售后",
      "客户服务与支持"
    ],
    "issueDimensions": [],
    "businessBackground": "零售商Best Buy希望让电话客服更快获取产品支持、维修和内部政策资料。",
    "problem": "数字和电话渠道中客服需要快速找到产品支持与维修资料。",
    "aiRole": "连接客服记录和内部知识，支持自助服务及客服实时查找文档。",
    "workflowDetail": "项目连接客户记录与知识资料，支持客户自助和坐席查找；来电拦截率不是客户问题最终解决率。",
    "implementation": {
      "disclosure": "limited",
      "challenges": [],
      "process": [
        "连接客户记录与内部知识；构建语音和聊天助手支持自助排障；客服接入时展示上下文，并实时推荐故障排除文件；团队分析交互数据以优化服务。"
      ],
      "evidence_gap": "企业 2024 年公告描述的功能当时尚待推出；后续供应商案例描述已使用功能。两者均未明确披露该项目具体实施难点。",
      "solution_details": {
        "data": "客户语音和聊天交互、客服记录、公司政策、故障排除及产品维修知识；数据授权与采样未披露。",
        "tools": "Gemini Enterprise for Customer Experience、Gemini Flash、CX Agent Studio、BigQuery 与 Generative Knowledge Assist。",
        "roles": "Best Buy 产品及内部团队与 Google Cloud Consulting 合作；客服处理复杂问题，经理使用分析结果开展培训；具体质检和审批职责未披露。",
        "evaluation": "来源称来电自助解决比例提高超过50%，转接率下降1.5%至2%；原文未明确百分比或百分点口径、观察期间及对照设计。"
      }
    },
    "result": "Google Cloud称通过AI自助服务来电拦截率提高超过50%。",
    "resultLimitations": "未说明完整基线与分母；拦截率不等于客户问题解决率。",
    "citationPolicy": "引用具体业务过程时注明来源；数字仅为来源披露，保留适用范围与上述限制，不承诺相同效果。",
    "questions": [
      "售后团队最常查找哪些产品资料？",
      "客户问题通常来自哪些渠道？",
      "如何确认问题是否真正解决？"
    ],
    "sources": [
      {
        "title": "Google Cloud：Best Buy客户支持",
        "url": "https://cloud.google.com/customers/bestbuy-ai",
        "type": "供应商客户案例",
        "publishedAt": null,
        "accessedAt": "2026-11-01"
      },
      {
        "title": "Best Buy：生成式 AI 客服规划",
        "url": "https://corporate.bestbuy.com/2024/generative-ai-customer-support/",
        "type": "企业新闻稿",
        "publishedAt": "2024-04-09",
        "accessedAt": "2026-11-01"
      }
    ],
    "matchSummary": "任务与痛点：数字和电话渠道中客服需要快速找到产品支持与维修资料。AI介入：连接客服记录和内部知识，支持自助服务及客服实时查找文档。公开数据条件：客户语音和聊天交互、客服记录、公司政策、故障排除及产品维修知识；数据授权与采样未披露。效果与来源：Google Cloud称通过AI自助服务来电拦截率提高超过50%（供应商客户案例披露）。限制：未说明完整基线与分母；拦截率不等于客户问题解决率。"
  }
] as const;
