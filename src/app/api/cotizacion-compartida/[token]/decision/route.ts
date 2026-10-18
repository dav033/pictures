import "server-only";

import { sharedQuoteHttpDependencies } from "@/lib/shared-quotes/dependencies.server";
import { handlePublicSharedQuoteDecision } from "@/lib/shared-quotes/http";
import { connection } from "next/server";


export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  await connection();
  const { token } = await context.params;
  return handlePublicSharedQuoteDecision(request, token, sharedQuoteHttpDependencies());
}
