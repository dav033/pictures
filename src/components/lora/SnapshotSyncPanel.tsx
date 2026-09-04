"use client";

import { useEffect, useState } from "react";

type SnapshotStatus = {
  live: {
    generatedAt: string;
    composicionGenerado: string | null;
    datasetImagenes: number;
    datasetCaptions: number;
  };
  savedAt: string | null;
  lastPublish: {
    publishedAt: string;
    host: string;
    container: string;
    containerPath: string;
    ok: boolean;
    imagenes?: { enviadas: number; sinOrigen: number; mb: number };
    error?: string;
  } | null;
};

function formatoFecha(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  try {
    return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function SnapshotSyncPanel() {
  const [estado, setEstado] = useState<SnapshotStatus | null>(null);
  const [cargando, setCargando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);

  const refrescarEstado = () => {
    fetch("/api/admin/snapshot")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SnapshotStatus | null) => setEstado(data))
      .catch(() => setEstado(null));
  };

  useEffect(() => {
    let vigente = true;
    fetch("/api/admin/snapshot")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SnapshotStatus | null) => {
        if (vigente) setEstado(data);
      })
      .catch(() => {
        if (vigente) setEstado(null);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const publicar = () => {
    setPublicando(true);
    setResultado(null);
    fetch("/api/admin/snapshot", { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        setResultado({
          ok: Boolean(data.ok),
          mensaje: data.ok
            ? `Publicado en ${data.host} · contenedor ${data.container}${
                data.imagenes ? ` · ${data.imagenes.enviadas} fotos (${data.imagenes.mb} MB)` : ""
              }`
            : data.error ?? "No se pudo publicar",
        });
      })
      .catch(() => setResultado({ ok: false, mensaje: "No se pudo publicar (error de red)" }))
      .finally(() => {
        setPublicando(false);
        setConfirmando(false);
        refrescarEstado();
      });
  };

  return (
    <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Snapshot hacia el servidor</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-texto-suave">
            El servidor de producción no tiene acceso a las carpetas locales de este equipo.
            Este snapshot empaqueta estadísticas y metadata (sin imágenes ni pesos) para que la
            pantalla de configuración y el dataset gallery muestren datos allí también.
          </p>
        </div>
      </div>

      {cargando ? (
        <p className="mt-4 text-sm text-texto-suave">Cargando estado…</p>
      ) : !estado ? (
        <p className="mt-4 text-sm text-texto-suave">No se pudo leer el estado local.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-superficie-2 px-4 py-3">
            <p className="text-xs text-texto-suave">Estado local actual</p>
            <p className="mt-1 text-sm font-medium text-texto">
              {estado.live.datasetImagenes} imágenes · {estado.live.datasetCaptions} captions
            </p>
            <p className="mt-1 text-xs text-texto-suave">Último snapshot guardado: {formatoFecha(estado.savedAt)}</p>
          </div>
          <div className="rounded-2xl bg-superficie-2 px-4 py-3">
            <p className="text-xs text-texto-suave">Última publicación al servidor</p>
            {estado.lastPublish ? (
              <>
                <p className={`mt-1 text-sm font-medium ${estado.lastPublish.ok ? "text-exito" : "text-error"}`}>
                  {estado.lastPublish.ok ? `OK · ${estado.lastPublish.host}` : "Falló"}
                </p>
                <p className="mt-1 text-xs text-texto-suave">
                  {formatoFecha(estado.lastPublish.publishedAt)}
                  {estado.lastPublish.ok && estado.lastPublish.imagenes
                    ? ` · ${estado.lastPublish.imagenes.enviadas} fotos (${estado.lastPublish.imagenes.mb} MB)`
                    : ""}
                  {!estado.lastPublish.ok && estado.lastPublish.error ? ` · ${estado.lastPublish.error}` : ""}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm font-medium text-texto">Nunca publicado</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!confirmando ? (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={cargando}
            className="rounded-xl bg-acento px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Sobreescribir estado en el servidor
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-aviso bg-aviso-suave px-3 py-2">
            <span className="text-sm text-texto">Esto reemplaza la copia actual del servidor. ¿Confirmar?</span>
            <button
              type="button"
              onClick={publicar}
              disabled={publicando}
              className="rounded-lg bg-acento px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {publicando ? "Publicando…" : "Sí, sobreescribir"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={publicando}
              className="rounded-lg border border-borde px-3 py-1.5 text-xs font-medium text-texto transition hover:bg-superficie-2"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {resultado && (
        <p className={`mt-3 text-sm ${resultado.ok ? "text-exito" : "text-error"}`}>{resultado.mensaje}</p>
      )}
    </section>
  );
}
