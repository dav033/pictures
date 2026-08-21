"use client";

import { useEffect, useState } from "react";

type Estado = {
  productos: number;
  variantes: number;
  ultimoSync: {
    terminadoEn: string | null;
    productos: number | null;
    variantes: number | null;
    inventarioCruzado: number | null;
    error: string | null;
  } | null;
};

export function CatalogoShopifyTab() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    fetch("/api/shopify/sync")
      .then((r) => r.json())
      .then((data) => {
        if (vigente) setEstado(data);
      });
    return () => {
      vigente = false;
    };
  }, []);

  async function sincronizar() {
    setSincronizando(true);
    setMensaje("Descargando el catálogo público y el inventario del CDN — puede tardar un minuto…");
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMensaje(`No se pudo sincronizar: ${data.error ?? "error desconocido"}`);
        return;
      }
      setMensaje(
        `Listo: ${data.productos} productos, ${data.variantes} variantes, ${data.inventarioCruzado} con inventario cruzado.`,
      );
      const res2 = await fetch("/api/shopify/sync");
      setEstado(await res2.json());
    } catch {
      setMensaje("No se pudo contactar al servidor.");
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-borde bg-superficie p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-texto">Catálogo real de Sempertex</h2>
            <p className="text-xs text-texto-suave">
              Importa productos y precios de www.sempertex.com y cruza el inventario con el CDN
              de la tienda B2B, por SKU.
            </p>
          </div>
          <button
            type="button"
            onClick={sincronizar}
            disabled={sincronizando}
            className="shrink-0 rounded-xl bg-acento px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
          >
            {sincronizando ? "Sincronizando…" : "Sincronizar catálogo"}
          </button>
        </div>
        {mensaje && <p className="mt-3 text-xs text-texto-suave">{mensaje}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">
          Estado actual
        </h2>
        {!estado ? (
          <p className="text-sm text-texto-suave">Cargando…</p>
        ) : estado.productos === 0 ? (
          <p className="text-sm text-texto-suave">
            Aún no se ha sincronizado el catálogo real. Usa el botón de arriba.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-borde bg-superficie p-3">
              <p className="text-2xl font-semibold text-texto">{estado.productos}</p>
              <p className="text-xs text-texto-suave">productos</p>
            </div>
            <div className="rounded-xl border border-borde bg-superficie p-3">
              <p className="text-2xl font-semibold text-texto">{estado.variantes}</p>
              <p className="text-xs text-texto-suave">variantes</p>
            </div>
            <div className="rounded-xl border border-borde bg-superficie p-3">
              <p className="text-2xl font-semibold text-texto">
                {estado.ultimoSync?.inventarioCruzado ?? "—"}
              </p>
              <p className="text-xs text-texto-suave">con inventario cruzado</p>
            </div>
            <div className="rounded-xl border border-borde bg-superficie p-3">
              <p className="text-2xl font-semibold text-texto">
                {estado.ultimoSync?.terminadoEn
                  ? new Date(estado.ultimoSync.terminadoEn).toLocaleString("es-CO")
                  : "—"}
              </p>
              <p className="text-xs text-texto-suave">último sync</p>
            </div>
          </div>
        )}
        {estado?.ultimoSync?.error && (
          <p className="mt-3 rounded-lg border border-error/40 bg-error-suave px-3 py-2 text-xs text-error">
            Último intento falló: {estado.ultimoSync.error} — el catálogo anterior sigue activo.
          </p>
        )}
      </section>
    </div>
  );
}
