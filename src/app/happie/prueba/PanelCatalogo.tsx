"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { HappiaPackage, HappiaPaginacion, HappiaServicio } from "@sempertex/happie-package-ia";

type Recurso = "services" | "packages";
type Respuesta =
  | { recurso: "services"; pagination: HappiaPaginacion; items: HappiaServicio[] }
  | { recurso: "packages"; pagination: HappiaPaginacion; items: HappiaPackage[] };
type Estado =
  | { tipo: "inactivo" }
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "listo"; datos: Respuesta; ms: number };

const LIMITE_MAXIMO: Record<Recurso, number> = { services: 500, packages: 100 };
const COBRO: Record<string, string> = { event: "por evento", unit: "por unidad", per_person: "por persona" };
const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function esRespuesta(cuerpo: unknown): cuerpo is Respuesta {
  if (typeof cuerpo !== "object" || cuerpo === null) return false;
  const c = cuerpo as Record<string, unknown>;
  const p = c.pagination as Record<string, unknown> | undefined;
  return (c.recurso === "services" || c.recurso === "packages") && Array.isArray(c.items)
    && typeof p?.totalItems === "number" && typeof p.totalPages === "number" && typeof p.currentPage === "number";
}

export function PanelCatalogo() {
  const [recurso, setRecurso] = useState<Recurso>("services");
  const [ciudad, setCiudad] = useState("");
  const [pagina, setPagina] = useState("1");
  const [limite, setLimite] = useState("5");
  const [estado, setEstado] = useState<Estado>({ tipo: "inactivo" });
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => () => abortar.current?.abort(), []);

  async function consultar(evento: FormEvent) {
    evento.preventDefault();
    abortar.current?.abort();
    const control = new AbortController();
    abortar.current = control;
    const consulta = new URLSearchParams({ recurso, page: pagina, limit: limite });
    if (ciudad.trim()) consulta.set("city", ciudad.trim().toLowerCase());
    setEstado({ tipo: "cargando" });
    const inicio = performance.now();
    try {
      const respuesta = await fetch(`/api/happie/prueba-api?${consulta}`, { signal: control.signal });
      const cuerpo: unknown = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        const mensaje = typeof cuerpo === "object" && cuerpo && "error" in cuerpo ? String(cuerpo.error) : `HTTP ${respuesta.status}`;
        setEstado({ tipo: "error", mensaje: `${respuesta.status}: ${mensaje}` });
        return;
      }
      if (!esRespuesta(cuerpo)) {
        setEstado({ tipo: "error", mensaje: "Respuesta inesperada del servidor." });
        return;
      }
      setEstado({ tipo: "listo", datos: cuerpo, ms: Math.round(performance.now() - inicio) });
    } catch (error) {
      if (control.signal.aborted) return;
      setEstado({ tipo: "error", mensaje: error instanceof Error ? error.message : "No se pudo consultar." });
    }
  }

  return (
    <section className="ui-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="titulo-catalogo">
      <div>
        <h2 id="titulo-catalogo" className="text-base font-semibold">Catálogo de Happia</h2>
        <p className="text-sm text-texto-suave">Lee <code>GET /api/services</code> y <code>/api/packages</code> con el cliente nuevo (sobre, paginación y validación).</p>
      </div>

      <form onSubmit={consultar} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          Recurso
          <select
            className="ui-input"
            value={recurso}
            onChange={(e) => {
              const siguiente = e.target.value as Recurso;
              setRecurso(siguiente);
              if (Number(limite) > LIMITE_MAXIMO[siguiente]) setLimite(String(LIMITE_MAXIMO[siguiente]));
            }}
          >
            <option value="services">Servicios</option>
            <option value="packages">Paquetes</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ciudad (slug)
          <input className="ui-input" value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="barranquilla" pattern="[a-zA-Z0-9\-]{0,60}" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Página
          <input className="ui-input" type="number" min={1} step={1} value={pagina} onChange={(e) => setPagina(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Límite (máx. {LIMITE_MAXIMO[recurso]})
          <input className="ui-input" type="number" min={1} max={LIMITE_MAXIMO[recurso]} step={1} value={limite} onChange={(e) => setLimite(e.target.value)} required />
        </label>
        <button type="submit" className="ui-button-primary rounded-lg px-3 py-2" disabled={estado.tipo === "cargando"}>
          {estado.tipo === "cargando" ? "Consultando…" : "Consultar"}
        </button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        {estado.tipo === "cargando" && <p className="text-sm text-texto-suave">Consultando…</p>}
        {estado.tipo === "error" && <p className="ui-alert">{estado.mensaje}</p>}
        {estado.tipo === "listo" && <Resultado datos={estado.datos} ms={estado.ms} />}
      </div>
    </section>
  );
}

function Resultado({ datos, ms }: { datos: Respuesta; ms: number }) {
  const { pagination: p } = datos;
  return (
    <>
      <p className="text-sm text-texto-suave">
        {p.totalItems} en total · página {p.currentPage} de {p.totalPages} · {datos.items.length} mostrados · {ms} ms
      </p>
      {datos.items.length === 0 ? (
        <p className="ui-alert">Sin resultados para esta consulta.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde-suave">
          {datos.recurso === "services" ? <TablaServicios items={datos.items} /> : <TablaPaquetes items={datos.items} />}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-texto-suave">Ver JSON recibido</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-superficie-suave p-3 text-xs">{JSON.stringify(datos, null, 2)}</pre>
      </details>
    </>
  );
}

const celda = "px-3 py-2 text-left align-top";

function TablaServicios({ items }: { items: HappiaServicio[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-superficie-suave text-texto-suave">
        <tr>
          <th className={celda}>Servicio</th><th className={celda}>Categoría</th><th className={celda}>Proveedor</th>
          <th className={celda}>Ciudad</th><th className={celda}>Precio</th><th className={celda}>Cobro</th><th className={celda}>Calificación</th>
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.id} className="border-t border-borde-suave">
            <td className={celda}>{s.name ?? s.category_name}</td>
            <td className={celda}>{s.category_name}</td>
            <td className={celda}>{s.provider_name}</td>
            <td className={celda}>{s.city}</td>
            <td className={celda}>{pesos.format(s.total)}</td>
            <td className={celda}>{COBRO[s.charge_mode] ?? s.charge_mode}{s.sale_unit ? ` (${s.sale_unit.singular})` : ""}</td>
            <td className={celda}>{s.rating ? `${s.rating.average} · ${s.rating.count}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaPaquetes({ items }: { items: HappiaPackage[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-superficie-suave text-texto-suave">
        <tr>
          <th className={celda}>Paquete</th><th className={celda}>Ciudad</th><th className={celda}>Invitados</th>
          <th className={celda}>Activo</th><th className={celda}>Servicios</th>
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.id} className="border-t border-borde-suave">
            <td className={celda}>{p.name}</td>
            <td className={celda}>{p.city ?? "—"}</td>
            <td className={celda}>{p.base_guests}</td>
            <td className={celda}>{p.is_active ? "Sí" : "No"}</td>
            <td className={celda}>{p.package_items.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
