import { useId, useState } from "react";
import { ReceptionMarkdown } from "./ReceptionMarkdown";
import {
  formatReceptionSample,
  formatReceptionDirectionChoice,
  type ReceptionInteraction,
} from "@ally-ahead/contracts";
import { useLocale } from "../../locales/context";

type Experiment = Extract<
  ReceptionInteraction,
  { type: "direction_comparison" | "sample_request" | "sample_result" }
>;
type Actions = {
  sampleSeed?: { task?: string; sample: string; reference: string };
  interactive: boolean;
  onAnswer: (body: string) => void;
  onCompose: (body: string) => void;
};

export function ReceptionExperiment({
  interaction,
  ...actions
}: { interaction: Experiment } & Actions) {
  if (interaction.type === "direction_comparison")
    return <DirectionComparison value={interaction} {...actions} />;
  if (interaction.type === "sample_request")
    return <SampleRequest value={interaction} {...actions} />;
  return <SampleResult value={interaction} {...actions} />;
}

function DirectionComparison({
  value,
  interactive,
  onAnswer,
}: { value: Extract<Experiment, { type: "direction_comparison" }> } & Actions) {
  const { t, locale } = useLocale();
  const recommended = value.directions.find(
    (direction) => direction.id === value.recommendedDirectionId,
  );
  return (
    <div className="reception-experiment reception-comparison">
      <h3>{value.title}</h3>
      <div className="reception-recommendation">
        <strong>
          {t("建议先试：", "Try first: ")}
          {recommended?.title}
        </strong>
        <ReceptionMarkdown text={value.recommendationReason} />
      </div>
      <details className="reception-comparison-basis">
        <summary>{t("比较依据与待确认假设", "Basis and assumptions")}</summary>
        {value.basis.length ? (
          <>
            <h4>{t("比较依据", "Basis")}</h4>
            <ul>
              {value.basis.map((item, index) => (
                <li key={index}>
                  <ReceptionMarkdown text={item} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {value.assumptions.length ? (
          <>
            <h4>{t("待确认假设", "Assumptions to check")}</h4>
            <ul>
              {value.assumptions.map((item, index) => (
                <li key={index}>
                  <ReceptionMarkdown text={item} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </details>
      <div className="reception-directions">
        {value.directions.map((direction, index) => (
          <article
            className="reception-direction"
            key={direction.id}
            data-recommended={direction.id === value.recommendedDirectionId}
          >
            <h4>
              {index + 1}. {direction.title}
              {direction.id === value.recommendedDirectionId ? (
                <span className="reception-experiment-badge">
                  {t("建议先试", "Try first")}
                </span>
              ) : null}
            </h4>
            <ReceptionMarkdown text={direction.approach} />
            <dl>
              <div>
                <dt>{t("预期帮助", "Expected benefit")}</dt>
                <dd>
                  <ReceptionMarkdown text={direction.benefit} />
                </dd>
              </div>
              <div>
                <dt>{t("需要先具备", "Prerequisites")}</dt>
                <dd>
                  {direction.prerequisites.length ? (
                    <ul>
                      {direction.prerequisites.map((item, i) => (
                        <li key={i}>
                          <ReceptionMarkdown text={item} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    t(
                      "暂未列出，请核对。",
                      "No prerequisites listed; please check.",
                    )
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("代价与取舍", "Tradeoff")}</dt>
                <dd>
                  <ReceptionMarkdown text={direction.tradeoff} />
                </dd>
              </div>
              <div>
                <dt>{t("人工负责", "Human responsibility")}</dt>
                <dd>
                  <ReceptionMarkdown text={direction.humanRole} />
                </dd>
              </div>
              <div>
                <dt>{t("先做一步", "First step")}</dt>
                <dd>
                  <ReceptionMarkdown text={direction.firstStep} />
                </dd>
              </div>
            </dl>
            {interactive ? (
              <button
                type="button"
                className="secondary"
                aria-label={`${t("按这个方向试一条", "Try this approach")}: ${direction.title}`}
                onClick={() =>
                  onAnswer(formatReceptionDirectionChoice(direction, locale))
                }
              >
                {t("按这个方向试一条", "Try this approach")}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function SampleRequest({
  value,
  sampleSeed,
  interactive,
  onAnswer,
}: { value: Extract<Experiment, { type: "sample_request" }> } & Actions) {
  const { t, locale } = useLocale();
  const id = useId();
  const [task, setTask] = useState(sampleSeed?.task ?? value.task);
  const [sample, setSample] = useState(sampleSeed?.sample ?? "");
  const [reference, setReference] = useState(sampleSeed?.reference ?? "");
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="reception-experiment reception-sample-request">
      <h3>{value.title}</h3>
      <ReceptionMarkdown text={value.prompt} />
      {interactive ? (
        <form
          className="reception-sample-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!interactive || !task.trim() || !sample.trim()) return;
            try {
              const body = formatReceptionSample(
                { task, sample, reference },
                locale,
              );
              setInvalid(false);
              onAnswer(body);
            } catch {
              setInvalid(true);
            }
          }}
        >
          {sampleSeed?.sample ? (
            <p className="form-hint">
              {t(
                "已带入上一条消息，请核对并保留要演练的样例。",
                "Your previous message is included. Check it and keep the example you want to try.",
              )}
            </p>
          ) : null}
          <label htmlFor={`${id}-task`}>{t("演练任务", "Task to try")}</label>
          <input
            id={`${id}-task`}
            value={task}
            maxLength={300}
            required
            onChange={(event) => setTask(event.target.value)}
          />
          <label htmlFor={`${id}-sample`}>
            {t("脱敏样例", "Anonymized example")}
          </label>
          <textarea
            id={`${id}-sample`}
            value={sample}
            maxLength={3000}
            rows={5}
            required
            placeholder={t(
              "放入一条已经脱敏、可以用于演练的真实样例。",
              "Paste one anonymized example that can be used for this exercise.",
            )}
            onChange={(event) => setSample(event.target.value)}
          />
          <label htmlFor={`${id}-reference`}>
            {t("参考资料（可选）", "Reference material (optional)")}
          </label>
          <textarea
            id={`${id}-reference`}
            value={reference}
            maxLength={6000}
            rows={4}
            placeholder={t(
              "例如：可公开的处理规则、分类定义或产品说明。",
              "For example: public handling rules, category definitions, or product information.",
            )}
            onChange={(event) => setReference(event.target.value)}
          />
          <p className="form-hint">
            {t(
              "请只放脱敏、非机密内容。没有参考资料时，结果会标为示意演练。",
              "Use only anonymized, non-confidential content. Without references, the result is an illustrative exercise.",
            )}
          </p>
          {invalid ? (
            <p className="error" role="alert">
              {t(
                "请核对任务和样例，缩短内容后再试。",
                "Check the task and example, and shorten the content before retrying.",
              )}
            </p>
          ) : null}
          <button
            type="submit"
            className="primary"
            disabled={!task.trim() || !sample.trim()}
          >
            {t("提交样例并演练", "Send example and try")}
          </button>
        </form>
      ) : (
        <p className="form-hint">
          {t("演练任务：", "Task: ")}
          {value.task}
        </p>
      )}
    </div>
  );
}

function SampleResult({
  value,
  interactive,
  onCompose,
}: { value: Extract<Experiment, { type: "sample_result" }> } & Actions) {
  const { t } = useLocale();
  return (
    <div className="reception-experiment reception-sample-result">
      <span className="reception-experiment-badge">
        {t("演练草稿 · 待人工核对", "Exercise draft · Human review required")}
      </span>
      <h3>{value.title}</h3>
      <p className="form-hint">
        {t("演练任务：", "Task: ")}
        {value.task}
      </p>
      <p className="reception-sample-mode">
        {value.mode === "grounded"
          ? t(
              "基于你提供的内容演练，请逐项核对原文。",
              "Based on the content you provided. Check each point against the original.",
            )
          : t(
              "示意演练：没有参考资料，内容不代表已验证的业务事实。",
              "Illustrative exercise: no reference material was provided. This is not verified business information.",
            )}
      </p>
      <ReceptionMarkdown
        className="reception-sample-output"
        text={value.output}
      />
      {value.mode === "grounded" && value.evidence.length ? (
        <section aria-label={t("原文证据", "Source evidence")}>
          <h4>{t("原文证据，请核对", "Source evidence to check")}</h4>
          {value.evidence.map((item, index) => (
            <blockquote key={index}>
              <p>{item.quote}</p>
              <cite>{item.note}</cite>
            </blockquote>
          ))}
        </section>
      ) : null}
      {value.limitations.length ? (
        <>
          <h4>{t("还不能据此确定", "Limits of this exercise")}</h4>
          <ul>
            {value.limitations.map((item, index) => (
              <li key={index}>
                <ReceptionMarkdown text={item} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4>{t("下一步", "Next step")}</h4>
      <ReceptionMarkdown text={value.nextStep} />
      <p className="form-hint">
        {t(
          "这里只做演练，尚未接入或执行真实业务流程。",
          "This is an exercise. No live business workflow has been connected or executed.",
        )}
      </p>
      {interactive ? (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onCompose(
              t(
                `我想调整“${value.task}”这份演练草稿：`,
                `I’d like to revise the exercise draft for “${value.task}”: `,
              ),
            )
          }
        >
          {t("补充或调整", "Add or revise")}
        </button>
      ) : null}
    </div>
  );
}
