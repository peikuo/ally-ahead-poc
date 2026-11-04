import {
  ReceptionDocumentList,
  ReceptionDocumentUpload,
  ReceptionDocumentSupplement,
  ReceptionDocumentView,

} from "@ally-ahead/contracts";
import type { z } from "zod";
import { receptionRequest } from "./reception";
export type DocumentList = z.infer<typeof ReceptionDocumentList>;
export type DocumentView = z.infer<typeof ReceptionDocumentView>;
const path = (id: string) => `/documents/${encodeURIComponent(id)}`;
export const receptionDocumentsApi = {
  list: (signal: AbortSignal) =>
    receptionRequest("/documents", ReceptionDocumentList, signal),
  reserve(
    token: string,
    file: File,
    clientRequestKey: string,
    signal: AbortSignal,
    replacesDocumentId?: string,
  ) {
    return receptionRequest("/documents", ReceptionDocumentView, signal, {
      token,
      body: ReceptionDocumentUpload.parse({
        fileName: file.name,
        format: file.name.split(".").at(-1)?.toLowerCase(),
        declaredBytes: file.size,
        clientRequestKey,
        confirmedNonConfidential: true,
        ...(replacesDocumentId ? { replacesDocumentId } : {}),
      }),
    });
  },
  content: (token: string, id: string, file: File, signal: AbortSignal) =>
    receptionRequest(
      `${path(id)}/content`,
      ReceptionDocumentView.refine((doc) => doc.id === id),
      signal,
      { token, method: "PUT", rawBody: file },
    ),
  retry: (token: string, id: string, signal: AbortSignal) =>
    receptionRequest(
      `${path(id)}/retry`,
      ReceptionDocumentView.refine((doc) => doc.id === id),
      signal,
      { token, body: {} },
    ),
  supplement: (
    token: string,
    id: string,
    text: string,
    userLocation: string,
    clientRequestKey: string,
    signal: AbortSignal,
    targetSourceId?: string,
  ) =>
    receptionRequest(
      `${path(id)}/supplements`,
      ReceptionDocumentView.refine((doc) => doc.id === id),
      signal,
      {
        token,
        body: ReceptionDocumentSupplement.parse({
          text,
          clientRequestKey,
          confirmedNonConfidential: true,
          ...(userLocation ? { userLocation } : {}),
          ...(targetSourceId ? { targetSourceId } : {}),
        }),
      },
    ),
  originalUrl: (id: string) => `/api/v1/reception${path(id)}/original`,
  markdownUrl: (id: string, sourceId: string) =>
    `/api/v1/reception${path(id)}/markdown?${new URLSearchParams({ sourceId })}`,
};
