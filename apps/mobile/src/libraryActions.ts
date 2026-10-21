import type { ApiClient, CaptureResponse } from "@svi/api-client";

/** The request action used by the Library screen's Save button. */
export async function saveSource(
  client: Pick<ApiClient, "createCapture">,
  rawUrl: string,
  sourceApp: string,
): Promise<CaptureResponse | undefined> {
  const url = rawUrl.trim();
  if (!url) return undefined;

  return client.createCapture({ url, sourceApp });
}
