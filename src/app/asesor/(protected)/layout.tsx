import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { advisorSessionFromCookies } from "@/lib/asesor/auth";

async function RequireAdvisorSession({ children }: { children: ReactNode }) {
  await connection();
  const jar = await cookies();
  const session = advisorSessionFromCookies((name) => jar.get(name)?.value);
  // One login only: the Demo Decoración one, which brings the customer back here.
  if (!session) redirect("/login?from=/asesor");
  return children;
}

export default function ProtectedAdvisorLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}><RequireAdvisorSession>{children}</RequireAdvisorSession></Suspense>;
}
