"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Check,
  Minus,
  Plus,
  Utensils,
  GlassWater,
  PartyPopper,
  Armchair,
  Truck,
  Music,
} from "lucide-react";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import { ArteTipoEvento } from "./Tema";
import { ListaRecomendaciones } from "./PaqueteCard";

type Opciones = {
  tipos: { etiqueta: string; clave: string; cantidad: number }[];
  necesidades: { etiqueta: string; clave: string; cantidad: number }[];
  ubicaciones: string[];
  invitadosSugeridos: { min: number; max: number } | null;
};

type Recomendacion = { paquete: HappiaPackage; razon: string };

const PASOS = ["Tipo de evento", "Invitados", "Servicios", "Dónde"] as const;
const TOTAL_PASOS = PASOS.length;

const ICONOS_NECESIDAD: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  comida: Utensils,
  bebidas: GlassWater,
  decoracion: PartyPopper,
  mobiliario: Armchair,
  transporte: Truck,
  entretenimiento: Music,
};

function EscenaSalon() {
  return (
    <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
      <path d="M0 140V64a150 150 0 0 1 300 0v76z" fill="#4c1d95" opacity="0.55" />
      <path d="M150 20v16" stroke="#fde68a" strokeWidth="1.4" opacity="0.75" fill="none" />
      <g className="happie-flota">
        <path d="M132 36h36l-8 15h-20z" fill="#fde68a" opacity="0.92" />
        <circle cx="140" cy="56" r="3.4" fill="#fde68a" opacity="0.8" />
        <circle cx="150" cy="60" r="3.4" fill="#fde68a" opacity="0.8" />
        <circle cx="160" cy="56" r="3.4" fill="#fde68a" opacity="0.8" />
      </g>
      <rect x="58" y="96" width="184" height="8" rx="3" fill="#ffffff" opacity="0.85" />
      <rect x="76" y="104" width="10" height="36" fill="#ffffff" opacity="0.5" />
      <rect x="214" y="104" width="10" height="36" fill="#ffffff" opacity="0.5" />
      <g fill="#f9a8d4" opacity="0.9">
        <circle cx="70" cy="82" r="9" />
        <circle cx="86" cy="76" r="7" />
        <circle cx="230" cy="82" r="9" />
        <circle cx="214" cy="76" r="7" />
      </g>
    </svg>
  );
}

function EscenaAireLibre() {
  return (
    <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
      <circle cx="238" cy="34" r="20" fill="#fde68a" />
      <path d="M0 108c40-14 76 8 116-2s72-22 110-8 74 6 74 6v36H0z" fill="#16a34a" opacity="0.85" />
      <path d="M0 122c46-10 88 6 132-2s84-14 168-4v24H0z" fill="#15803d" opacity="0.7" />
      <g>
        <rect x="66" y="72" width="4" height="34" rx="2" fill="#78350f" />
        <circle cx="68" cy="66" r="17" fill="#22c55e" />
        <circle cx="56" cy="74" r="11" fill="#16a34a" />
        <circle cx="80" cy="74" r="11" fill="#16a34a" />
      </g>
      <g className="happie-flota" opacity="0.95">
        <ellipse cx="160" cy="52" rx="12" ry="15" fill="#ec4899" />
        <path d="M160 67l-2.6 8h5.2z" fill="#ec4899" opacity="0.8" />
      </g>
      <g className="happie-flota" style={{ animationDelay: "1.2s" }} opacity="0.95">
        <ellipse cx="190" cy="66" rx="10" ry="13" fill="#ffffff" />
        <path d="M190 79l-2.2 7h4.4z" fill="#ffffff" opacity="0.8" />
      </g>
    </svg>
  );
}

function EscenaCasa() {
  return (
    <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
      <path d="M0 140V96h300v44z" fill="#c2410c" opacity="0.35" />
      <path d="M84 96V56l66-32 66 32v40z" fill="#7c2d12" opacity="0.82" />
      <path d="M150 18l78 40H72z" fill="#9a3412" />
      <rect x="136" y="66" width="28" height="30" rx="3" fill="#fde68a" />
      <rect x="100" y="66" width="20" height="18" rx="2" fill="#fde68a" opacity="0.75" />
      <rect x="180" y="66" width="20" height="18" rx="2" fill="#fde68a" opacity="0.75" />
      <g className="happie-flota">
        <circle cx="66" cy="60" r="9" fill="#ec4899" opacity="0.9" />
        <circle cx="90" cy="52" r="7" fill="#a855f7" opacity="0.9" />
        <circle cx="112" cy="56" r="8" fill="#22d3ee" opacity="0.9" />
      </g>
      <g className="happie-flota" style={{ animationDelay: "1.5s" }}>
        <circle cx="234" cy="58" r="9" fill="#facc15" opacity="0.9" />
        <circle cx="212" cy="52" r="7" fill="#ec4899" opacity="0.9" />
      </g>
    </svg>
  );
}

const ESCENAS: Record<string, () => React.JSX.Element> = {
  "Salón de eventos": EscenaSalon,
  "Al aire libre": EscenaAireLibre,
  Casa: EscenaCasa,
};

function Figura({ activo }: { activo: boolean }) {
  return (
    <svg width="17" height="34" viewBox="0 0 17 34" fill={activo ? "#6d3fe0" : "#c4b5e8"} className="shrink-0">
      <circle cx="8.5" cy="7" r="5.4" />
      <path d="M8.5 14.5c-4.4 0-6.6 2.8-6.6 7.2V33h13.2V21.7c0-4.4-2.2-7.2-6.6-7.2z" />
    </svg>
  );
}

export function WizardFlow({
  idsEnCarrito,
  onAgregar,
}: {
  idsEnCarrito: Set<string>;
  onAgregar: (paquete: HappiaPackage) => void;
}) {
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [cargandoOpciones, setCargandoOpciones] = useState(true);
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null);

  const [paso, setPaso] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [tipoEvento, setTipoEvento] = useState<string | null>(null);
  const [invitados, setInvitados] = useState(30);
  const [necesidades, setNecesidades] = useState<string[]>([]);
  const [ubicacion, setUbicacion] = useState<string | null>(null);

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomendaciones, setRecomendaciones] = useState<Recomendacion[]>([]);
  const [resumen, setResumen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/happie/opciones")
      .then((r) => r.json())
      .then((datos) => {
        if (datos.error) throw new Error(datos.error);
        setOpciones(datos);
        if (datos.invitadosSugeridos) setInvitados(datos.invitadosSugeridos.min);
      })
      .catch((err) => setErrorOpciones(err instanceof Error ? err.message : "Error desconocido"))
      .finally(() => setCargandoOpciones(false));
  }, []);

  const figuras = useMemo(() => {
    const total = Math.min(14, Math.max(1, Math.round(invitados / 3)));
    return Array.from({ length: total }, (_, i) => i < Math.round(total * 0.72));
  }, [invitados]);

  function alternarNecesidad(etiqueta: string) {
    setNecesidades((actual) =>
      actual.includes(etiqueta) ? actual.filter((n) => n !== etiqueta) : [...actual, etiqueta],
    );
  }

  async function buscar() {
    if (!tipoEvento || !invitados || !ubicacion || cargando) return;
    setCargando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/happie/recomendar-pasos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipoEvento, invitados, ubicacion, necesidades }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? "Error desconocido");
      setRecomendaciones(datos.recomendaciones ?? []);
      setResumen(datos.resumen ?? null);
      setPaso(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setPaso(1);
    setTipoEvento(null);
    setNecesidades([]);
    setUbicacion(null);
    setRecomendaciones([]);
    setResumen(null);
    setError(null);
  }

  function siguiente() {
    if (paso === TOTAL_PASOS) {
      buscar();
      return;
    }
    setPaso((p) => (p < TOTAL_PASOS ? ((p + 1) as 1 | 2 | 3 | 4) : p));
  }

  if (cargandoOpciones) {
    return (
      <p className="flex items-center gap-2 text-sm text-texto-suave">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando catálogo…
      </p>
    );
  }

  if (!opciones) {
    return <p className="text-sm text-error">{errorOpciones ?? "No se pudo cargar el catálogo."}</p>;
  }

  const puedeAvanzar =
    paso === 1 ? Boolean(tipoEvento) : paso === 2 ? invitados > 0 : paso === 3 ? true : Boolean(ubicacion);

  return (
    <div className="flex flex-col gap-7">
      {paso < 5 && (
        <div className="flex items-center">
          {PASOS.map((nombre, i) => {
            const n = i + 1;
            const activo = paso === n;
            const hecho = paso > n;
            return (
              <div key={nombre} className="flex flex-grow items-center last:flex-grow-0">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                    style={{
                      background: paso >= n ? "var(--acento)" : "var(--superficie-2)",
                      color: paso >= n ? "#fff" : "var(--texto-suave)",
                    }}
                  >
                    {hecho ? <Check className="h-3.5 w-3.5" strokeWidth={2.8} /> : n}
                  </div>
                  <span
                    className="whitespace-nowrap text-[13px]"
                    style={{ color: activo ? "var(--texto)" : "var(--texto-suave)", fontWeight: activo ? 600 : 500 }}
                  >
                    {nombre}
                  </span>
                </div>
                {n < TOTAL_PASOS && (
                  <div
                    className="mx-3.5 h-0.5 flex-grow rounded-full"
                    style={{ background: paso > n ? "var(--acento)" : "var(--acento-suave)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {paso === 1 && (
        <div className="happie-entra flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight text-texto sm:text-[30px]">¿Qué vas a celebrar?</h1>
            <p className="text-sm text-texto-suave">Estos son los tipos de evento que tenemos armados hoy.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {opciones.tipos.map((tipo) => {
              const elegido = tipoEvento === tipo.etiqueta;
              return (
                <button
                  key={tipo.etiqueta}
                  onClick={() => {
                    setTipoEvento(tipo.etiqueta);
                    setPaso(2);
                  }}
                  className="happie-tarjeta flex flex-col overflow-hidden rounded-[18px] border-2 bg-superficie text-left shadow-[0_2px_10px_var(--sombra)]"
                  style={{ borderColor: elegido ? "var(--acento)" : "var(--borde)" }}
                >
                  <ArteTipoEvento clave={tipo.clave} className="h-32 w-full" />
                  <div className="flex items-center justify-between p-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[16px] font-semibold text-texto">{tipo.etiqueta}</span>
                      <span className="text-xs text-texto-suave">
                        {tipo.cantidad > 0 ? `${tipo.cantidad} paquetes` : "Próximamente"}
                      </span>
                    </div>
                    {elegido && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-acento">
                        <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.8} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="happie-entra flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight text-texto sm:text-[30px]">¿Cuántos van?</h1>
            <p className="text-sm text-texto-suave">Nos sirve para ordenar los paquetes según lo que cubren.</p>
          </div>

          <div className="flex flex-wrap items-center gap-6 rounded-[20px] border border-borde bg-superficie p-6 shadow-[0_2px_10px_var(--sombra)] sm:gap-7 sm:p-8">
            <button
              onClick={() => setInvitados((v) => Math.max(1, v - 5))}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-borde text-acento"
            >
              <Minus className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>
            <div className="flex w-[100px] flex-col items-center gap-0.5">
              <span className="text-[42px] font-bold leading-none tracking-tight text-texto sm:text-[46px]">{invitados}</span>
              <span className="text-xs text-texto-suave">invitados</span>
            </div>
            <button
              onClick={() => setInvitados((v) => v + 5)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-borde text-acento"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>

            <div className="flex h-12 flex-grow items-end gap-[3px] overflow-hidden">
              {figuras.map((activo, i) => (
                <Figura key={i} activo={activo} />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[10, 20, 30, 50].map((n) => (
              <button
                key={n}
                onClick={() => setInvitados(n)}
                className="rounded-full border px-4 py-2 text-[13px] font-medium"
                style={
                  invitados === n
                    ? { borderColor: "var(--acento)", background: "var(--acento-suave)", color: "var(--acento)" }
                    : { borderColor: "var(--borde)", background: "var(--superficie)", color: "var(--texto-suave)" }
                }
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="happie-entra flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight text-texto sm:text-[30px]">¿Qué servicios necesitas?</h1>
            <p className="text-sm text-texto-suave">Elige los que apliquen — puedes marcar varios, o ninguno.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {opciones.necesidades.map((necesidad) => {
              const elegido = necesidades.includes(necesidad.etiqueta);
              const Icono = ICONOS_NECESIDAD[necesidad.clave] ?? PartyPopper;
              return (
                <button
                  key={necesidad.etiqueta}
                  onClick={() => alternarNecesidad(necesidad.etiqueta)}
                  className="happie-tarjeta flex flex-col items-start gap-3 rounded-[16px] border-2 bg-superficie p-4 text-left shadow-[0_2px_10px_var(--sombra)]"
                  style={{ borderColor: elegido ? "var(--acento)" : "var(--borde)" }}
                >
                  <div className="flex w-full items-center justify-between">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-[10px]"
                      style={{ background: elegido ? "var(--acento)" : "var(--superficie-2)" }}
                    >
                      <Icono className={elegido ? "h-[18px] w-[18px] text-white" : "h-[18px] w-[18px] text-texto-suave"} strokeWidth={1.8} />
                    </div>
                    {elegido && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-acento">
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-semibold text-texto">{necesidad.etiqueta}</span>
                    <span className="text-[11px] text-texto-suave">
                      {necesidad.cantidad > 0 ? `${necesidad.cantidad} paquetes` : "Próximamente"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {paso === 4 && (
        <div className="happie-entra flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight text-texto sm:text-[30px]">¿Dónde será?</h1>
            <p className="text-sm text-texto-suave">El lugar cambia qué decoración funciona mejor.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {opciones.ubicaciones.map((u) => {
              const elegido = ubicacion === u;
              const Escena = ESCENAS[u];
              return (
                <button
                  key={u}
                  onClick={() => setUbicacion(u)}
                  className="happie-tarjeta flex flex-col overflow-hidden rounded-[18px] border-2 bg-superficie text-left shadow-[0_2px_10px_var(--sombra)]"
                  style={{ borderColor: elegido ? "var(--acento)" : "var(--borde)" }}
                >
                  <div className="relative h-[140px] w-full overflow-hidden">{Escena && <Escena />}</div>
                  <div className="flex items-center justify-between p-4">
                    <span className="text-[15.5px] font-semibold text-texto">{u}</span>
                    {elegido && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-acento">
                        <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.8} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {paso === 5 && (
        <div className="flex flex-col gap-5">
          <button onClick={reiniciar} className="flex w-fit items-center gap-1 text-xs text-texto-suave hover:text-texto">
            <ChevronLeft className="h-3.5 w-3.5" /> Empezar de nuevo
          </button>
          {resumen && <p className="text-sm italic text-texto-suave">{resumen}</p>}
          {recomendaciones.length === 0 ? (
            <p className="text-sm text-texto-suave">No encontramos paquetes que encajen bien. Intenta con otro tipo de evento.</p>
          ) : (
            <ListaRecomendaciones recomendaciones={recomendaciones} idsEnCarrito={idsEnCarrito} onAgregar={onAgregar} />
          )}
        </div>
      )}

      {paso < 5 && (
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-borde pt-5">
          <button
            onClick={() => setPaso((p) => Math.max(1, p - 1) as 1 | 2 | 3 | 4)}
            disabled={paso === 1}
            className="flex items-center gap-1.5 rounded-xl border border-borde bg-superficie px-4 py-2.5 text-[13px] font-semibold text-texto-suave disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
            Atrás
          </button>
          <button
            onClick={siguiente}
            disabled={!puedeAvanzar || cargando}
            className="flex items-center gap-1.5 rounded-xl bg-acento px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_6px_16px_var(--sombra-acento)] disabled:opacity-40"
          >
            {cargando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : paso === TOTAL_PASOS ? (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            ) : null}
            {paso === TOTAL_PASOS ? "Ver paquetes" : "Continuar"}
            {paso !== TOTAL_PASOS && <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />}
          </button>
        </div>
      )}
    </div>
  );
}
