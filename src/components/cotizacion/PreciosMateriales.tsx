"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { TEXTO_ESTADO_PRECIO, estadoPrecioMaterial, nombreMaterialCliente, type EstadoPrecio } from "@/lib/cotizacion/borrador-profesional";
import type { LineaMaterialProfesional } from "@/lib/cotizacion/profesional";
import { BaldosaGlobo, GloboMiniatura } from "@/components/guiado/GloboMiniatura";
import { agruparPorProducto, fichaGlobo, type FichaGlobo } from "@/components/guiado/ficha-globo";
import { DUR, EASE_SALIDA, grupoConRitmo, hijoEscalonado } from "@/components/guiado/animacion/movimiento";
import { Campo, MensajesDeError } from "./Campo";
import { CLASE_NO_VIGENTE, importeOGuion, numero, pesos } from "./formato";

type Props = {
  /**
   * Por variante: cómo se ve cada globo (foto del catálogo, color, acabado, tamaño, globos por paquete), sacado
   * de la cotización. Solo para pintarlo; sin esto se deduce del nombre del material.
   */
  fichas?: Readonly<Record<string, FichaGlobo>>;
  clave: string;
  materiales: readonly LineaMaterialProfesional[];
  /** Lo que el usuario escribió como precio por paquete, por variante (sin entrada: el del catálogo). */
  precios: Record<string, string>;
  /** Qué dice cada precio malo o a medias, por variante. */
  errores: Record<string, string>;
  atenuar: boolean;
  /** Subtotal de cada material según el último cálculo de Python. */
  subtotalDe: (variantId: string) => number | null;
  /** Total de materiales según Python, o `null`. */
  total: number | null;
  onPrecio: (variantId: string, texto: string | null) => void;
};

/** Cómo se ve el estado del precio bajo el número de paquetes. */
const CLASE_ESTADO: Record<EstadoPrecio, string> = {
  catalogo: "text-texto-suave",
  propio: "font-medium text-acento",
  vacio: "font-medium text-error",
  ilegible: "font-medium text-error",
};

/**
 * Los precios por paquete de los materiales de la propuesta. Plegado: lo común
 * es dejar el precio de catálogo. Con un precio malo o a medias se abre solo,
 * porque el campo que hay que corregir no puede quedar escondido.
 *
 * Cada globo se ve con su foto del catálogo (o su dibujo con el color y el
 * acabado) y las variantes del mismo producto Sempertex en distintos tamaños
 * van juntas. Los paquetes y los subtotales son los de Python: aquí solo se
 * agrupan y se muestran.
 */
export function PreciosMateriales({ clave, materiales, precios, errores, atenuar, subtotalDe, total, onPrecio, fichas }: Props) {
  const [abierto, setAbierto] = useState(false);
  const hayErrores = Object.keys(errores).length > 0;
  const visible = abierto || hayErrores;
  const grupos = useMemo(
    () => agruparPorProducto(materiales, (material) => fichas?.[material.variant_id] ?? fichaGlobo({ nombre: material.descripcion })),
    [materiales, fichas],
  );
  return (
    <details
      className="group mt-5 rounded-2xl ring-1 ring-borde-suave ring-inset"
      open={visible}
      onToggle={(evento) => setAbierto(evento.currentTarget.open)}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-[13px] font-semibold text-texto transition-colors hover:bg-superficie-suave focus-visible:outline-2 focus-visible:outline-acento">
        <span className="flex min-w-0 items-center gap-3">
          <PilaGlobos fichas={grupos.slice(0, 4).map((grupo) => grupo.ficha)} />
          <span className="min-w-0">
            Tus materiales · {materiales.length} {materiales.length === 1 ? "producto" : "productos"}
            <span className="block text-xs font-normal text-texto-suave">Con precio de catálogo; cámbialo si compras a otro.</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span className={atenuar && total !== null ? CLASE_NO_VIGENTE : ""}>{total !== null && importeOGuion(total)}</span>
          <ChevronDown className="size-4 text-texto-suave transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <motion.ul
        className="space-y-2 border-t border-borde-suave p-2.5 @md:p-3"
        aria-label="Materiales del precio al cliente"
        initial={false}
        animate={visible ? "visible" : "oculto"}
        variants={grupoConRitmo(0.05, 0.04)}
      >
        {grupos.map((grupo) => (
          <motion.li key={grupo.clave} variants={hijoEscalonado} className="rounded-2xl bg-superficie p-2.5 shadow-[0_1px_2px_var(--sombra)] ring-1 ring-borde-suave ring-inset @md:p-3">
            <div className="flex items-center gap-3">
              <BaldosaGlobo hex={grupo.ficha.hex} acabado={grupo.ficha.acabado} pulgadas={null} foto={grupo.ficha.foto} tamano={52} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-texto" title={grupo.ficha.producto}>{grupo.ficha.producto}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-texto-suave">
                  {grupo.ficha.familia && <span className="rounded-full bg-acento-suave px-2 py-px text-[11px] font-semibold text-acento">Sempertex {grupo.ficha.familia}</span>}
                  {grupo.ficha.acabadoCliente && <span>{grupo.ficha.acabadoCliente}</span>}
                  {grupo.items.length > 1 && <span>· {grupo.items.length} tamaños</span>}
                </p>
              </div>
            </div>
            <ul className="mt-2 divide-y divide-borde-suave">
              {grupo.items.map(({ item: material, ficha }) => {
                const escrito = precios[material.variant_id];
                const estado = estadoPrecioMaterial(escrito, material.precio_paquete_catalogo_cop);
                const error = errores[material.variant_id];
                const nombre = nombreMaterialCliente(material.descripcion);
                const idEntrada = `precio-${clave}-${material.variant_id}`;
                const valor = subtotalDe(material.variant_id);
                return (
                  <li key={material.variant_id} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 py-2.5 last:pb-0.5 @md:grid-cols-[2.75rem_minmax(0,1fr)_9rem_2.75rem_6rem]">
                    <span className="col-start-1 row-start-1 inline-grid h-7 min-w-11 place-items-center rounded-full bg-superficie-2 px-1.5 text-xs font-semibold whitespace-nowrap tabular-nums text-texto ring-1 ring-borde-suave ring-inset" title={nombre}>
                      {ficha.medida ?? "·"}
                    </span>
                    <span className="col-start-2 row-start-1 min-w-0">
                      <span className="block text-[13px] font-medium text-texto">
                        {numero.format(material.paquetes)} {material.paquetes === 1 ? "paquete" : "paquetes"}{ficha.unidadesPaquete ? ` de ${numero.format(ficha.unidadesPaquete)}` : ""}
                      </span>
                      <span className={`block text-xs ${CLASE_ESTADO[estado]}`}>{TEXTO_ESTADO_PRECIO[estado]}</span>
                    </span>
                    <span className="col-span-2 col-start-2 row-start-2 flex items-center gap-1.5 @md:col-span-2 @md:col-start-3 @md:row-start-1">
                      <Campo
                        id={idEntrada}
                        className="max-w-44 flex-1"
                        tipo="pesos"
                        derecha
                        etiqueta="Por paquete"
                        nombre={`Precio por paquete de ${nombre}`}
                        valor={escrito !== undefined ? escrito : numero.format(material.precio_paquete_catalogo_cop)}
                        onValor={(texto) => onPrecio(material.variant_id, texto)}
                        error={error}
                        destacado={estado === "propio"}
                      />
                      {/* El hueco del botón se reserva siempre: el campo no cambia de ancho al escribir. */}
                      <span className="grid size-11 shrink-0 place-items-center">
                        {estado !== "catalogo" && (
                          <button
                            type="button"
                            onClick={() => onPrecio(material.variant_id, null)}
                            aria-label={`Volver al precio de catálogo de ${nombre}`}
                            title={`Precio de catálogo: ${pesos.format(material.precio_paquete_catalogo_cop)}`}
                            className="grid size-11 place-items-center rounded-lg text-texto-suave hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento"
                          >
                            <RotateCcw className="size-4" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    </span>
                    <span className={`col-start-3 row-start-1 text-right text-sm font-semibold tabular-nums text-texto @md:col-start-5 ${atenuar && valor !== null ? CLASE_NO_VIGENTE : ""}`}>
                      {valor === null ? importeOGuion(valor) : <ImporteAnimado valor={valor} />}
                    </span>
                    <MensajesDeError mensajes={error ? [{ id: idEntrada, texto: error }] : []} />
                  </li>
                );
              })}
            </ul>
          </motion.li>
        ))}
      </motion.ul>
    </details>
  );
}

/** Hasta cuatro globos superpuestos en la cabecera plegada: se ve de qué colores es la compra sin abrirla. */
function PilaGlobos({ fichas }: { fichas: readonly FichaGlobo[] }) {
  if (fichas.length === 0) return null;
  return (
    // En móvil (contenedor estrecho) el título manda: la pila solo se ve con sitio.
    <span className="hidden shrink-0 -space-x-2.5 @sm:flex" aria-hidden="true">
      {fichas.map((ficha, indice) => (
        <span key={`${ficha.grupo}-${indice}`} className="grid size-8 place-items-center rounded-full bg-superficie ring-2 ring-superficie" style={{ zIndex: fichas.length - indice }}>
          <GloboMiniatura hex={ficha.hex} acabado={ficha.acabado} tamano={26} />
        </span>
      ))}
    </span>
  );
}

/**
 * El subtotal que llega de Python: cuando cambia (otro precio por paquete), cuenta hasta el nuevo valor y da un
 * pequeño salto para que se note qué fila cambió. Con movimiento reducido salta directo.
 */
function ImporteAnimado({ valor }: { valor: number }) {
  const reducido = useReducedMotion();
  const actual = useMotionValue(valor);
  const texto = useTransform(actual, (cifra) => pesos.format(Math.round(cifra)));
  useEffect(() => {
    if (reducido) {
      actual.jump(valor);
      return;
    }
    const control = animate(actual, valor, { duration: 0.6, ease: EASE_SALIDA });
    return () => control.stop();
  }, [valor, reducido, actual]);
  return (
    <motion.span
      key={valor}
      className="inline-block"
      initial={reducido ? false : { opacity: 0.5, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.media, ease: EASE_SALIDA }}
    >
      <span className="sr-only">{pesos.format(valor)}</span>
      <motion.span aria-hidden="true">{texto}</motion.span>
    </motion.span>
  );
}
