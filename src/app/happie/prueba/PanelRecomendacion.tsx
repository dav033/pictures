"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Recomendacion = { url: string; razon: string };
type Estado =
  | { tipo: "inactivo" }
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "listo"; recomendaciones: Recomendacion[]; resumen: string; ms: number };

/** The panel renders whatever the server sent: check the shape instead of trusting a cast. */
function leerRecomendaciones(cuerpo: unknown): { recomendaciones: Recomendacion[]; resumen: string } | null {
  if (typeof cuerpo !== "object" || cuerpo === null || !("recomendaciones" in cuerpo) || !Array.isArray(cuerpo.recomendaciones)) return null;
  const recomendaciones: Recomendacion[] = [];
  for (const r of cuerpo.recomendaciones) {
    if (typeof r !== "object" || r === null || typeof (r as Recomendacion).url !== "string" || typeof (r as Recomendacion).razon !== "string") return null;
    recomendaciones.push({ url: (r as Recomendacion).url, razon: (r as Recomendacion).razon });
  }
  const resumen = "resumen" in cuerpo && typeof cuerpo.resumen === "string" ? cuerpo.resumen : "";
  return { recomendaciones, resumen };
}

export function PanelRecomendacion() {
  const [tipoEvento, setTipoEvento] = useState("Cumpleaños");
  const [invitados, setInvitados] = useState("20");
  const [presupuesto, setPresupuesto] = useState("2000000");
  const [preferencias, setPreferencias] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "inactivo" });
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => () => abortar.current?.abort(), []);

  async function pedir(evento: FormEvent) {
    evento.preventDefault();
    abortar.current?.abort();
    const control = new AbortController();
    abortar.current = control;
    const lista = preferencias.split(",").map((p) => p.trim()).filter(Boolean);
    setEstado({ tipo: "cargando" });
    const inicio = performance.now();
    try {
      const respuesta = await fetch("/api/happie/prueba-api/recomendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipoEvento: tipoEvento.trim(),
          invitados: Number(invitados),
          presupuesto: Number(presupuesto),
          ...(lista.length ? { preferencias: lista } : {}),
        }),
        signal: control.signal,
      });
      const cuerpo: unknown = await respuesta.json().catch(() => null);
      const ok = leerRecomendaciones(cuerpo);
      if (!respuesta.ok || !ok) {
        const mensaje = typeof cuerpo === "object" && cuerpo && "error" in cuerpo ? String(cuerpo.error) : "Respuesta inesperada.";
        setEstado({ tipo: "error", mensaje: `${respuesta.status}: ${mensaje}` });
        return;
      }
      setEstado({ tipo: "listo", recomendaciones: ok.recomendaciones, resumen: ok.resumen, ms: Math.round(performance.now() - inicio) });
    } catch (error) {
      if (control.signal.aborted) return;
      setEstado({ tipo: "error", mensaje: error instanceof Error ? error.message : "No se pudo consultar." });
    }
  }

  return (
    <section className="ui-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="titulo-recomendacion">
      <div>
        <h2 id="titulo-recomendacion" className="text-base font-semibold">Recomendación de paquetes</h2>
        <p className="text-sm text-texto-suave">
          Ejecuta la misma lógica del webhook <code>/api/happie/webhook/recommend-packages</code> con tu sesión (la API key no sale del servidor).
          Cada consulta usa una llamada de IA.
        </p>
      </div>

      <form onSubmit={pedir} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5">
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-1">
          Tipo de evento
          <input className="ui-input" value={tipoEvento} onChange={(e) => setTipoEvento(e.target.value)} maxLength={120} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Invitados
          <input className="ui-input" type="number" min={1} step={1} value={invitados} onChange={(e) => setInvitados(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Presupuesto (COP)
          <input className="ui-input" type="number" min={1} step="any" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Preferencias (coma)
          <input className="ui-input" value={preferencias} onChange={(e) => setPreferencias(e.target.value)} placeholder="tema acuarela, comida" />
        </label>
        <button type="submit" className="ui-button-primary rounded-lg px-3 py-2" disabled={estado.tipo === "cargando"}>
          {estado.tipo === "cargando" ? "Pensando…" : "Pedir recomendación"}
        </button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        {estado.tipo === "cargando" && <p className="text-sm text-texto-suave">Pensando…</p>}
        {estado.tipo === "error" && <p className="ui-alert">{estado.mensaje}</p>}
        {estado.tipo === "listo" && (
          <>
            <p className="text-sm text-texto-suave">{estado.recomendaciones.length} recomendación(es) · {estado.ms} ms</p>
            {estado.recomendaciones.length === 0 ? (
              <p className="ui-alert">La IA no encontró un paquete que encaje.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {estado.recomendaciones.map((r, indice) => (
                  <li key={indice} className="rounded-lg border border-borde-suave p-3 text-sm">
                    <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-acento underline-offset-2 hover:underline">{r.url}</a>
                    <p className="mt-1 text-texto-suave">{r.razon}</p>
                  </li>
                ))}
              </ol>
            )}
            {estado.resumen && <p className="text-sm">{estado.resumen}</p>}
          </>
        )}
      </div>
    </section>
  );
}
