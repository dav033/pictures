import "server-only";

import { sharedQuoteHttpDependencies } from "@/lib/shared-quotes/dependencies.server";
import { handlePublicSharedStill } from "@/lib/shared-quotes/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  return handlePublicSharedStill(token, sharedQuoteHttpDependencies());
}
