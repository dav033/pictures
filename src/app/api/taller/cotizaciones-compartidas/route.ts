import "server-only";

import { sharedQuoteHttpDependencies } from "@/lib/shared-quotes/dependencies.server";
import { handleCreateSharedQuote, handleListOwnerSharedQuotes } from "@/lib/shared-quotes/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleCreateSharedQuote(request, sharedQuoteHttpDependencies(request));
}

export async function GET(request: Request): Promise<Response> {
  return handleListOwnerSharedQuotes(request, sharedQuoteHttpDependencies(request));
}
