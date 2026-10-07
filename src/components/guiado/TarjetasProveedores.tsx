"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, MapPin, MapPinOff } from "lucide-react";
import type { ProveedorSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { iniciales } from "./formato";
import { RESORTE, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";

const TIPOS: Record<ProveedorSempertex["tipo"], string> = {
  decorador_happia: "Decorador certificado HAPPIA",
  mbp: "Master Balloon Pro",
  distribuidor: "Distribuidor Sempertex",
  ecommerce: "Tienda en línea",
};

type Props = {
  proveedores: readonly ProveedorSempertex[];
  activo: boolean;
  onSolicitar: (proveedor: ProveedorSempertex) => void;
  /** El que el cliente eligió: en el historial queda marcado y los demás, atenuados. */
  solicitadoId?: string | null;
  /** Ciudades con proveedores registrados, para el vacío («Prueba en…»). */
  ciudadesDisponibles?: readonly string[];
  onElegirCiudad?: (ciudad: string) => void;
  /** Salida del vacío: «Ver cómo hacerlo yo». */
  onHacerloYo?: () => void;
  /** Qué se buscaba, para decirlo bien en el vacío; sin pasar, se deduce de la lista o se dice «decoradores». */
  tipoBuscado?: "decorador" | "distribuidor";
};

const esDecorador = (proveedor: ProveedorSempertex) => proveedor.tipo === "decorador_happia" || proveedor.tipo === "mbp";

/**
 * Decoradores y distribuidores de la ciudad del cliente. No enlaza a ninguna web; la elección se resuelve dentro
 * de la conversación. Sin resultados, ofrece otras ciudades y la salida de hacerlo uno mismo.
 */
export function TarjetasProveedores({ proveedores, activo, onSolicitar, solicitadoId = null, ciudadesDisponibles = [], onElegirCiudad, onHacerloYo, tipoBuscado }: Props) {
  const [pulsado, setPulsado] = useState<string | null>(null);
  const temporizadorRef = useRef<number | null>(null);
  useEffect(() => () => { if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current); }, []);

  if (!proveedores.length) {
    const palabra = tipoBuscado === "distribuidor" ? "distribuidores" : "decoradores";
    return (
      <div className="mt-3 rounded-2xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)]">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-superficie-2 text-texto-suave" aria-hidden><MapPinOff className="size-5" /></span>
          <div>
            <p className="font-semibold text-texto">Todavía no tengo {palabra} en esa ciudad</p>
            {(ciudadesDisponibles.length > 0 || onHacerloYo) && <p className="mt-0.5 text-sm text-texto-suave">{ciudadesDisponibles.length > 0 ? "Puedo buscarte en estas ciudades:" : "Puedes armarla tú con la guía paso a paso."}</p>}
          </div>
        </div>
        {activo && (ciudadesDisponibles.length > 0 || onHacerloYo) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {onElegirCiudad && ciudadesDisponibles.map((ciudad) => (
              <button key={ciudad} type="button" onClick={() => onElegirCiudad(ciudad)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-borde bg-superficie px-4 text-sm font-medium text-texto transition-colors hover:border-acento hover:bg-acento-suave hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40">
                <MapPin className="size-4" aria-hidden />{ciudad}
              </button>
            ))}
            {onHacerloYo && (
              <button type="button" onClick={onHacerloYo} className="inline-flex min-h-11 items-center rounded-full border border-acento/40 bg-superficie px-4 text-sm font-medium text-acento transition-colors hover:border-acento hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40">
                Ver cómo hacerlo yo
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const soloDistribuidores = proveedores.every((proveedor) => !esDecorador(proveedor));
  const elegir = (proveedor: ProveedorSempertex) => {
    if (pulsado) return;
    setPulsado(proveedor.id);
    temporizadorRef.current = window.setTimeout(() => { setPulsado(null); onSolicitar(proveedor); }, 300);
  };

  return (
    <motion.div variants={grupoConRitmo(0.06)} initial="oculto" animate="visible" className="mt-4 grid gap-3 sm:grid-cols-2" aria-label={soloDistribuidores ? "Distribuidores" : "Decoradores y distribuidores"}>
      {proveedores.map((proveedor) => {
        const decorador = esDecorador(proveedor);
        const solicitado = solicitadoId === proveedor.id;
        const atenuado = solicitadoId !== null && !solicitado;
        const enCurso = pulsado === proveedor.id;
        return (
          <motion.article
            key={proveedor.id}
            variants={hijoEscalonado}
            className={`flex flex-col rounded-2xl border bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)] transition-opacity ${solicitado ? "border-acento ring-2 ring-acento" : "border-borde-suave"} ${atenuado ? "opacity-50" : ""}`}
          >
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-acento-suave text-sm font-semibold text-acento" aria-hidden>{iniciales(proveedor.nombre)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-acento">{TIPOS[proveedor.tipo]}</p>
                <h3 className="mt-0.5 font-semibold leading-snug text-texto">{proveedor.nombre}</h3>
              </div>
              {proveedor.origen === "ejemplo" && <span className="shrink-0 rounded-full bg-acento-suave px-2 py-0.5 text-[0.7rem] font-semibold text-acento">Ejemplo</span>}
            </div>
            {proveedor.especialidad && <p className="mt-3 text-sm text-texto">{proveedor.especialidad}</p>}
            <p className="mb-4 mt-1 flex items-center gap-1.5 text-sm text-texto-suave"><MapPin className="size-3.5 shrink-0" aria-hidden />{proveedor.zona.cobertura.join(" · ")}</p>
            {solicitado ? (
              <span className="mt-auto inline-flex items-center gap-1.5 self-start rounded-full bg-acento-suave px-3 py-1 text-xs font-medium text-acento"><Check className="size-3.5" aria-hidden />{decorador ? "Elegiste este decorador" : "Elegiste esta tienda"}</span>
            ) : activo && solicitadoId === null ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                transition={RESORTE}
                disabled={pulsado !== null}
                onClick={() => elegir(proveedor)}
                className={`mt-auto inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 ${enCurso ? "bg-exito text-fondo" : "bg-acento text-sobre-acento hover:bg-acento-hover disabled:opacity-60"}`}
              >
                {enCurso && <Check className="size-4" aria-hidden />}
                {decorador ? "Elegir este decorador" : "Quiero comprar aquí"}
              </motion.button>
            ) : null}
          </motion.article>
        );
      })}
    </motion.div>
  );
}
