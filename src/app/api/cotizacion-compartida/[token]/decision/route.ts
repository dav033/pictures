import "server-only";

import { sharedQuoteHttpDependencies } from "@/lib/shared-quotes/dependencies.server";
import { handlePublicSharedQuoteDecision } from "@/lib/shared-quotes/http";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  return handlePublicSharedQuoteDecision(request, token, sharedQuoteHttpDependencies());
}
