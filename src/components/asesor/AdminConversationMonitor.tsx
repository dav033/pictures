"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { AdminConversationSnapshot } from "@/lib/asesor/admin";
import { ADMIN_MONITOR_REFRESH_MS, adminPollFailed, adminPollSucceeded } from "@/lib/asesor/admin-poll-state";

const SnapshotSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updatedAt: z.string(),
  status: z.enum(["in_progress", "brief_ready", "approved"]),
  progress: z.object({ complete: z.boolean(), completed: z.number(), required: z.number(), missing: z.array(z.string()) }),
  lastQuestion: z.string().nullable(),
}).strict();

const ListResponseSchema = z.object({ conversations: z.array(SnapshotSchema) }).strict();

export function AdminConversationMonitor({
  initialSnapshot,
  initialError = false,
}: {
  initialSnapshot: AdminConversationSnapshot[] | null;
  initialError?: boolean;
}) {
  const [pollState, setPollState] = useState({ snapshot: initialSnapshot, error: initialError });

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/asesor/admin/conversations", { cache: "no-store" });
        if (!response.ok) throw new Error("admin_monitor_request_failed");
        const parsed = ListResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("admin_monitor_response_invalid");
        if (!disposed) {
          setPollState((current) => adminPollSucceeded(current, parsed.data.conversations));
        }
      } catch {
        if (!disposed) setPollState(adminPollFailed);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), ADMIN_MONITOR_REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <section className="space-y-4" aria-label="Conversaciones">
      {pollState.error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">No se pudo actualizar el monitor. Se conserva la última información cargada.</p>}
      {pollState.snapshot === null ? (
        <p>{pollState.error ? "No hay una captura disponible." : "Cargando conversaciones…"}</p>
      ) : pollState.snapshot.length === 0 ? (
        <p>No hay conversaciones de clientes.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-left text-sm">
            <thead><tr className="border-b bg-muted/40"><th className="p-3">Conversación</th><th className="p-3">Estado</th><th className="p-3">Avance</th><th className="p-3">Última pregunta</th><th className="p-3">Actualizada</th></tr></thead>
            <tbody>
              {pollState.snapshot.map((conversation) => (
                <tr key={conversation.id} className="border-b last:border-0">
                  <td className="p-3"><a className="underline underline-offset-4" href={`/asesor/admin/${encodeURIComponent(conversation.id)}`}>{conversation.title || conversation.id}</a></td>
                  <td className="p-3">{conversation.status === "approved" ? "Aprobado" : conversation.status === "brief_ready" ? "Brief listo" : "En curso"}</td>
                  <td className="p-3">{conversation.progress.completed}/{conversation.progress.required}</td>
                  <td className="max-w-md p-3">{conversation.lastQuestion ?? "—"}</td>
                  <td className="whitespace-nowrap p-3">{new Date(conversation.updatedAt).toLocaleString("es-CO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
