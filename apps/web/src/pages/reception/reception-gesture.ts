import {
  decodeReceptionPresentation,
  formatReceptionDirectionChoice,
} from "@ally-ahead/contracts";

// A local acknowledgment of an explicitly submitted UI choice. This does not
// interpret arbitrary conversation or mark a business milestone complete.
export function isReceptionAcknowledgement(
  reply: string | undefined,
  submitted: string,
) {
  if (!reply) return false;
  const interaction = decodeReceptionPresentation(reply)?.interaction;
  const text = submitted.trim();
  if (interaction?.type === "demand_review")
    return text === "确认这份理解" || text === "I confirm this understanding.";
  return (
    interaction?.type === "direction_comparison" &&
    interaction.directions.some(
      (direction) =>
        text === formatReceptionDirectionChoice(direction, "zh") ||
        text === formatReceptionDirectionChoice(direction, "en"),
    )
  );
}
