type Translate = (zh: string, en: string) => string;

export function opsTime(
  value: string | null | undefined,
  locale: string,
): string {
  if (!value || !Number.isFinite(Date.parse(value)))
    return locale === "zh" ? "未记录" : "Not recorded";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function opsDuration(
  value: number | null | undefined,
  t: Translate,
): string {
  if (value == null || !Number.isFinite(value))
    return t("未记录", "Not recorded");
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(1)} s`;
}

export function opsNumber(
  value: number | null | undefined,
  t: Translate,
): string {
  return value == null
    ? t("未记录", "Not recorded")
    : new Intl.NumberFormat().format(value);
}

export function opsState(value: string, t: Translate): string {
  const labels: Record<string, [string, string]> = {
    pending: ["等待中", "Pending"],
    running: ["运行中", "Running"],
    retry_wait: ["等待重试", "Retry pending"],
    done: ["已结束", "Done"],
    failed: ["失败", "Failed"],
    cancelled: ["已停止", "Stopped"],
  };
  const pair = labels[value];
  return pair ? t(...pair) : value;
}

export function opsEvent(
  type: string,
  t: Translate,
): { label: string; tone: string; icon: string } {
  const labels: Record<string, [string, string]> = {
    model_started: ["模型请求", "Model request"],
    model_request_context: ["请求上下文", "Request context"],
    model_output: ["原始模型输出", "Raw model output"],
    assistant_saved: ["保存最终答复", "Final reply saved"],
    runtime_started: ["开始处理", "Run started"],
    context_restored: ["恢复上下文", "Context restored"],
    model_request: ["模型请求", "Model request"],
    model_request_started: ["模型请求", "Model request"],
    model_response: ["模型响应", "Model response"],
    model_request_completed: ["模型响应", "Model response"],
    skill_read: ["读取技能", "Skill read"],
    skill_loaded: ["载入技能", "Skill loaded"],
    tool_started: ["调用工具", "Tool started"],
    tool_completed: ["工具返回", "Tool completed"],
    tool_declaration_registered: ["注册工具", "Tools registered"],
    output_validation: ["校验输出", "Output validation"],
    skill_validation: ["校验技能", "Skill validation"],
    output_correction: ["纠正输出", "Output correction"],
    output_correction_exhausted: ["纠正次数用尽", "Corrections exhausted"],
    delivery_saved: ["保存中间交付", "Intermediate delivery saved"],
    final_saved: ["保存最终答复", "Final reply saved"],
    progress_notice_committed: ["保存成果记录", "Achievement saved"],
    runtime_completed: ["处理结束", "Run completed"],
    runtime_failed: ["处理失败", "Run failed"],
  };
  const tone = /failed|exhausted/.test(type)
    ? "danger"
    : /correction|recovery/.test(type)
      ? "amber"
      : /saved|committed|completed/.test(type)
        ? "green"
        : /model/.test(type)
          ? "blue"
          : /skill|tool|read/.test(type)
            ? "violet"
            : "neutral";
  return {
    label: labels[type] ? t(...labels[type]) : type,
    tone,
    icon:
      tone === "danger"
        ? "!"
        : tone === "green"
          ? "✓"
          : tone === "amber"
            ? "↻"
            : tone === "blue"
              ? "◇"
              : tone === "violet"
                ? "⌁"
                : "·",
  };
}
