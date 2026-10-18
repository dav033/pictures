import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerSharedQuote } from "@/components/shared-quotes/CustomerSharedQuote";
import { sharedQuoteDependencies } from "@/lib/shared-quotes/dependencies.server";
import { getPublicSharedQuote } from "@/lib/shared-quotes/service";
import { connection } from "next/server";

// Token lookups must run per request: without connection() `cacheComponents` would freeze them into the build.
export const instant = false;

export const metadata: Metadata = {
  title: "Cotización compartida · Sempertex",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const dependencies = sharedQuoteDependencies();
  const quote = await getPublicSharedQuote(dependencies, token);
  if (!quote) notFound();

  const canRespond = dependencies.readerEnabled && dependencies.writerEnabled;
  return <CustomerSharedQuote token={token} quote={quote} canRespond={canRespond} />;
}
