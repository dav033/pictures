"use client";

import { useEffect, useState } from "react";

type ProveedorId = "gemini";

type Salud = {
  proveedores: Array<{
    id: ProveedorId;
    disponible: boolean;
    modelo: { chat: string; imagen: string };
  }>;
  ajusteGlobal: ProveedorId | null;
  telemetria: Array<{
    cuando: string;
    proveedor: ProveedorId;
    operacion: string;
    ms: number;
    resultado: "ok" | "error";
    tokensEntrada?: number;
    tokensSalida?: number;
    tokensCacheados?: number;
    error?: string;
  }>;
};

const NOMBRE: Record<ProveedorId, string> = { gemini: "Gemini" };

export function MotorIATab() {
  const [salud, setSalud] = useState<Salud | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const res = await fetch("/api/ia/salud");
    setSalud(await res.json());
  }

  useEffect(() => {
    let vigente = true;
    fetch("/api/ia/salud")
      .then((r) => r.json())
      .then((data) => {
        if (vigente) setSalud(data);
      });
    return () => {
      vigente = false;
    };
  }, []);

  async function elegirGlobal(id: ProveedorId) {
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/ia/proveedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: id, alcance: "admin" }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMensaje(data.error ?? "No se pudo cambiar el proveedor.");
        return;
      }
      await cargar();
      setMensaje(`Proveedor global cambiado a ${NOMBRE[id]}.`);
    } finally {
      setGuardando(false);
    }
  }

  if (!salud) return <p className="text-sm text-texto-suave">Cargando…</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">
          Proveedor por defecto (global)
        </h2>
        <div className="flex flex-col gap-2">
          {salud.proveedores.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${
                p.disponible ? "border-borde bg-superficie" : "border-borde bg-superficie-2 opacity-60"
              }`}
            >
              <input
                type="radio"
                name="proveedor-global"
                checked={salud.ajusteGlobal === p.id}
                disabled={!p.disponible || guardando}
                onChange={() => elegirGlobal(p.id)}
              />
              <span className="flex-1">
                <span className="font-medium text-texto">{NOMBRE[p.id]}</span>
                <span className="ml-2 text-xs text-texto-suave">
                  chat: {p.modelo.chat} · imagen: {p.modelo.imagen}
                </span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  p.disponible ? "bg-exito-suave text-exito" : "bg-superficie text-texto-suave"
                }`}
              >
                {p.disponible ? "llave configurada" : "sin llave"}
              </span>
            </label>
          ))}
        </div>
        {mensaje && <p className="mt-2 text-xs text-texto-suave">{mensaje}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">
          Últimas llamadas
        </h2>
        {salud.telemetria.length === 0 ? (
          <p className="text-xs text-texto-suave">Aún no hay llamadas registradas.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-borde">
            <table className="w-full text-left text-xs">
              <thead className="bg-superficie-2 text-texto-suave">
                <tr>
                  <th className="px-3 py-2">Cuándo</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Operación</th>
                  <th className="px-3 py-2">ms</th>
                  <th className="px-3 py-2">Tokens</th>
                  <th className="px-3 py-2">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {salud.telemetria.map((e, i) => (
                  <tr key={i} className="border-t border-borde">
                    <td className="px-3 py-2">{new Date(e.cuando).toLocaleTimeString()}</td>
                    <td className="px-3 py-2">{NOMBRE[e.proveedor]}</td>
                    <td className="px-3 py-2">{e.operacion}</td>
                    <td className="px-3 py-2">{e.ms}</td>
                    <td className="px-3 py-2">
                      {e.tokensEntrada !== undefined ? `${e.tokensEntrada} / ${e.tokensSalida}` : "—"}
                      {e.tokensCacheados ? (
                        <span className="ml-1 text-texto-suave">({e.tokensCacheados} cacheados)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {e.resultado === "ok" ? (
                        <span className="text-exito">ok</span>
                      ) : (
                        <span className="text-error" title={e.error}>
                          error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
