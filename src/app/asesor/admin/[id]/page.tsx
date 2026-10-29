import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { ASESOR_SESSION_COOKIE } from "@/lib/asesor/auth";
import { getAdminConversationDetail, getAdminPageAccess } from "@/lib/asesor/admin";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { readingLines } from "@/lib/asesor/photo-evidence";

export const instant = false;

export default async function AdminConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const access = getAdminPageAccess(jar.get(ASESOR_SESSION_COOKIE)?.value);
  if (access === "anonymous") redirect("/asesor/login?admin=1");
  if (access === "forbidden") forbidden();
  const { id } = await params;

  let conversation;
  try {
    conversation = await getAdminConversationDetail(createAsesorRepository(), id);
  } catch {
    return <main className="mx-auto max-w-5xl px-6 py-10"><h1 className="text-2xl font-semibold">Conversación no disponible</h1><p role="alert">No fue posible cargar los datos guardados.</p><Link href="/asesor/admin" className="underline">Volver al monitor</Link></main>;
  }
  if (!conversation) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="space-y-2"><Link href="/asesor/admin" className="text-sm underline">← Volver al monitor</Link><h1 className="text-2xl font-semibold">{conversation.title || "Conversación"}</h1><p className="text-sm text-muted-foreground">Estado: {conversation.status}</p></header>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Transcripción</h2>
        {conversation.transcript.length === 0 ? <p>No hay mensajes guardados.</p> : <ol className="space-y-3">{conversation.transcript.map((message) => <li key={message.id} className="rounded-lg border p-4"><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{message.role === "user" ? "Cliente" : message.role === "assistant" ? "Asesor" : "Sistema"}</p><p className="whitespace-pre-wrap">{message.content}</p>{message.attachments.length > 0 && <ul className="mt-3 space-y-3 text-sm text-muted-foreground">{message.attachments.map((attachment) => <li key={attachment.id} className="flex items-center gap-3"><Image src={`/api/asesor/photos/${encodeURIComponent(attachment.id)}`} alt={attachment.kind === "venue" ? "Foto del lugar" : "Foto de inspiración"} width={112} height={80} unoptimized className="h-20 w-28 rounded object-cover" /><span>Foto {attachment.kind === "venue" ? "del lugar" : "de inspiración"} · {attachment.mimeType} · {attachment.byteSize} bytes · confirmación {attachment.confirmed === null ? "pendiente" : attachment.confirmed ? "sí" : "no"} · preferencia {attachment.preference} · referencia {attachment.id}{attachment.reading && <span className="mt-1 block text-foreground">Lectura del asesor: {readingLines(attachment.reading).map((line) => `${line.label}: ${line.value}`).join(" · ")}</span>}{attachment.keep.length > 0 && <span className="mt-1 block text-foreground">Conservar sí o sí: {attachment.keep.join(" · ")}</span>}</span></li>)}</ul>}</li>)}</ol>}
      </section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Datos guardados del evento</h2><pre className="overflow-x-auto rounded-lg border p-4 text-sm">{JSON.stringify(conversation.brief, null, 2)}</pre></section>
    </main>
  );
}
