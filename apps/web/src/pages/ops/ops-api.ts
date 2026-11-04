import {
  TraceViewerFilters,
  TraceViewerEventQuery,
  TraceViewerSessionPage,
  TraceViewerRunPage,
  TraceViewerEventPage,
  TraceViewerEventDetail,
  type TraceViewerFilterInput,
} from "@ally-ahead/contracts";
import { readOps } from "./ops-reader";

function query(input: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) params.set(key, String(value));
  return `?${params}`;
}
export const consultationOps = {
  sessions: (
    token: string,
    input: TraceViewerFilterInput,
    signal: AbortSignal,
  ) =>
    readOps(
      `/sessions${query(TraceViewerFilters.parse(input))}`,
      token,
      TraceViewerSessionPage,
      signal,
    ),
  runs: (
    token: string,
    id: string,
    input: TraceViewerFilterInput,
    signal: AbortSignal,
  ) =>
    readOps(
      `/sessions/${encodeURIComponent(id)}/runs${query(TraceViewerFilters.parse(input))}`,
      token,
      TraceViewerRunPage.refine((page) =>
        page.items.every((item) => item.sessionId === id),
      ),
      signal,
    ),
  events: (
    token: string,
    id: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    readOps(
      `/runs/${encodeURIComponent(id)}/events${query(TraceViewerEventQuery.parse({ limit: 20, cursor }))}`,
      token,
      TraceViewerEventPage.refine((page) =>
        page.items.every((item) => item.runId === id),
      ),
      signal,
    ),
  detail: (token: string, run: string, event: string, signal: AbortSignal) =>
    readOps(
      `/runs/${encodeURIComponent(run)}/events/${encodeURIComponent(event)}`,
      token,
      TraceViewerEventDetail.refine(
        (item) => item.runId === run && item.eventId === event,
      ),
      signal,
    ),
};
