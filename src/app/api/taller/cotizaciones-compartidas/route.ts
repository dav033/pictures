import "server-only";

import { sharedQuoteHttpDependencies } from "@/lib/shared-quotes/dependencies.server";
import { handleCreateSharedQuote, handleListOwnerSharedQuotes } from "@/lib/shared-quotes/http";
import { connection } from "next/server";


export async function POST(request: Request): Promise<Response> {
  await connection();
  return handleCreateSharedQuote(request, sharedQuoteHttpDependencies(request));
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleListOwnerSharedQuotes(request, sharedQuoteHttpDependencies(request));
}
