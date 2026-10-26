import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { AdminConversationMonitor } from "@/components/asesor/AdminConversationMonitor";
import { ASESOR_SESSION_COOKIE } from "@/lib/asesor/auth";
import { getAdminPageAccess, listAdminConversationSnapshots } from "@/lib/asesor/admin";
import { createAsesorRepository } from "@/lib/asesor/repository";

export const instant = false;

export default async function AdminConversationListPage() {
  const jar = await cookies();
  const access = getAdminPageAccess(jar.get(ASESOR_SESSION_COOKIE)?.value);
  if (access === "anonymous") redirect("/asesor/login?admin=1");
  if (access === "forbidden") forbidden();

  let initialSnapshot = null;
  let initialError = false;
  try {
    initialSnapshot = await listAdminConversationSnapshots(createAsesorRepository());
  } catch {
    initialError = true;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-10">
      <header><h1 className="text-2xl font-semibold">Monitor del asesor</h1><p className="text-sm text-muted-foreground">Conversaciones de clientes · actualización cada 5 segundos</p></header>
      <AdminConversationMonitor initialSnapshot={initialSnapshot} initialError={initialError} />
    </main>
  );
}
