import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ASESOR_SESSION_COOKIE, readAdvisorSessionToken } from "@/lib/asesor/auth";

async function RequireAdvisorSession({ children }: { children: ReactNode }) {
  await connection();
  const jar = await cookies();
  const session = readAdvisorSessionToken(jar.get(ASESOR_SESSION_COOKIE)?.value);
  if (!session) redirect("/asesor/login");
  return children;
}

export default function ProtectedAdvisorLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}><RequireAdvisorSession>{children}</RequireAdvisorSession></Suspense>;
}
