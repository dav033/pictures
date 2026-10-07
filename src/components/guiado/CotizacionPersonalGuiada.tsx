"use client";

import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { motion } from "motion/react";
import { acabadoCliente, conAcabado, nombreLineaCliente, partesLinea, pulgadasDe } from "./formato";
import { BaldosaGlobo } from "./GloboMiniatura";
import { colorSempertex } from "./color-sempertex";
import { fichasDeCotizacion } from "./ficha-globo";
import { productoSempertex } from "./piezas-vista";
import { DUR, EASE_SALIDA, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Tonos que el cliente nombra aparte y que la paleta junta con otro («azul marino» va con «azul»). */
const HEX_TONO: Readonly<Record<string, string>> = { "azul marino": "#1f2d5c" };

type FilaCotizacion = { clave: string; nombre: string; esGlobo: boolean; acabado: string | null; color?: string; hex?: string; cantidad: number; paquetes: number; unidadesPaquete: number | null; sobrante: number; subtotal: number };

/**
 * Filas para PRESENTAR: una por variante del catálogo, con el globo en palabras de cliente («Globo rosado de 12"»).
 * El nombre sale de la nota del material en la idea elegida (su color ya viene dicho para el cliente) y, sin ella,
 * del nombre de la línea. Si dos variantes quedan con el mismo nombre, se distinguen por el acabado. Ordenadas por
 * color y tamaño. El total NO sale de aquí: es cotizacion.total.
 */
function filasCotizacion(cotizacion: Cotizacion, decoracion: DecoracionSempertex | undefined): FilaCotizacion[] {
  const filas = new Map<string, FilaCotizacion>();
  for (const linea of cotizacion.lineas) {
    const variante = linea.varianteId ?? linea.id;
    const nota = decoracion?.materiales.find((material) => material.variantId === variante)?.nota;
    const fuente = nota ? { nombre: nota } : linea;
    const partes = partesLinea(fuente);
    // Un globo redondo con su producto Sempertex reconocido se nombra por ese producto y se pinta con la fuente única
    // (`color-sempertex`): «Sempertex Reflex Plata de 12"». El dueño (2026-10-06): «esto debería dar globos Sempertex,
    // no genéricos»; el verificador vio «Globo reflex dorado de 5″» en «Tus materiales». Con la nota de la idea, su
    // producto («Fashion Fucsia»); sin producto reconocido, el nombre de cliente de siempre.
    // Con la nota también: su título dice el globo que se compra y su etiqueta, lo que vio el análisis de la foto. El
    // «Fashion Azul Caribe» de la columna arcoíris tiene la etiqueta «azul celeste» y la cotización decía «Globo celeste
    // de 12"» mientras la tarjeta y la tabla decían «Azul caribe» (probador, 2026-10-07): nombre y tono, del producto.
    const titulo = nota ? nota.split(" · ")[0]! : linea.nombre;
    const sempertex = partes.esGlobo && !partes.forma && titulo ? colorSempertex(linea.color ?? partes.color, { titulo }) : null;
    const reconocido = sempertex?.producto ? sempertex : null;
    const producto = reconocido?.producto ?? (nota && partes.esGlobo && !partes.forma ? productoSempertex(titulo) : null);
    const pulgadasTexto = partes.pulgadas ? ` de ${partes.pulgadas}"` : "";
    const nombre = producto ? `Sempertex ${producto}${pulgadasTexto}` : nombreLineaCliente(fuente);
    const colorNombre = reconocido ? reconocido.nombre.toLocaleLowerCase("es") : partes.color;
    const previa = filas.get(variante);
    const unidades = linea.unidadesPaquete ?? null;
    if (previa) {
      previa.cantidad += linea.cantidadNecesaria ?? 0;
      previa.paquetes += linea.paquetes ?? 0;
      previa.sobrante += linea.sobrante ?? 0;
      previa.subtotal += linea.subtotal ?? 0;
      if (previa.unidadesPaquete !== unidades) previa.unidadesPaquete = null;
    } else {
      const hex = reconocido?.hex ?? HEX_COLORES_V2[colorNombre as keyof typeof HEX_COLORES_V2] ?? HEX_TONO[colorNombre] ?? (linea.color ? HEX_COLORES_V2[linea.color as keyof typeof HEX_COLORES_V2] : undefined);
      filas.set(variante, { clave: variante, nombre, esGlobo: partes.esGlobo, acabado: acabadoCliente(nota ?? linea.nombre), ...(linea.color ? { color: linea.color } : {}), ...(hex ? { hex } : {}), cantidad: linea.cantidadNecesaria ?? 0, paquetes: linea.paquetes ?? 0, unidadesPaquete: unidades, sobrante: linea.sobrante ?? 0, subtotal: linea.subtotal ?? 0 });
    }
  }
  const lista = [...filas.values()];
  const repetidos = new Set(lista.filter((fila, indice) => lista.findIndex((otra) => otra.nombre === fila.nombre) !== indice).map((fila) => fila.nombre));
  for (const fila of lista) if (repetidos.has(fila.nombre) && fila.acabado) fila.nombre = conAcabado(fila.nombre, fila.acabado);
  const pulgadas = (fila: FilaCotizacion) => Number.parseFloat((pulgadasDe(fila.nombre) ?? "99").replace(",", "."));
  return lista.sort((a, b) => (a.color ?? a.nombre).localeCompare(b.color ?? b.nombre, "es") || pulgadas(a) - pulgadas(b) || a.nombre.localeCompare(b.nombre, "es"));
}

/** «globos» o, para un producto que no es globo (una cortina), «unidades»; en singular con 1. */
function unidadDe(fila: FilaCotizacion): string {
  return fila.esGlobo ? (fila.cantidad === 1 ? "globo" : "globos") : (fila.cantidad === 1 ? "unidad" : "unidades");
}

export function CotizacionPersonalGuiada({ cotizacion, decoracion }: { cotizacion: Cotizacion; decoracion?: DecoracionSempertex }) {
  const sobranteTotal = cotizacion.lineas.reduce((total, linea) => total + (linea.sobrante ?? 0), 0);
  const filas = filasCotizacion(cotizacion, decoracion);
  // Cómo se ve cada globo (foto del catálogo o dibujo con su color y acabado): solo para pintarlo.
  const fichas = fichasDeCotizacion(cotizacion.lineas.map((linea) => {
    const nota = decoracion?.materiales.find((material) => material.variantId === (linea.varianteId ?? linea.id))?.nota;
    return nota ? { ...linea, nombre: nota } : linea;
  }));
  const sempertex = Object.values(fichas).some((ficha) => ficha.familia !== null);
  return (
    <section aria-label="Cotización de materiales" data-testid="cotizacion-personal-guiada" className="mt-3 w-full overflow-hidden rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)]">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 @xl:px-5.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-acento">Materiales para tu decoración</p>
          {sempertex && <p className="mt-0.5 text-xs text-texto-suave">Globos Sempertex, con la foto de cada uno</p>}
        </div>
        <p className="text-right">
          <span className="block text-xs text-texto-suave">Total con IVA</span>
          {/* `data-precio-total`: a él va la vista cuando el cliente pregunta el precio por chat; entra resaltado y se apaga. */}
          <span data-precio-total className="relative block scroll-mt-24 text-2xl font-semibold tracking-tight tabular-nums text-texto">
            <motion.span aria-hidden className="absolute -inset-x-2 -inset-y-0.5 rounded-lg bg-acento-suave" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.4, delay: 0.6, ease: EASE_SALIDA }} />
            <span className="relative">{pesos.format(cotizacion.total)}</span>
          </span>
        </p>
      </div>
      <motion.ul className="mt-2 px-4 @xl:px-5.5" aria-label="Materiales por color" initial="oculto" animate="visible" variants={grupoConRitmo(0.05, 0.05)}>
        {filas.map((fila) => {
          const ficha = fichas[fila.clave];
          const hex = fila.hex ?? ficha?.hex ?? "#9ca3af";
          const comprados = fila.cantidad + fila.sobrante;
          return (
            <motion.li key={fila.clave} variants={hijoEscalonado} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-borde-suave py-3 last:border-b-0">
              <BaldosaGlobo hex={hex} acabado={ficha?.acabado ?? null} pulgadas={null} foto={ficha?.foto ?? null} tamano={48} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-texto">{fila.nombre}</span>
                <span className="mt-0.5 block text-xs leading-5 text-texto-suave">
                  Usas {numero.format(fila.cantidad)} {unidadDe(fila)} · compras {numero.format(fila.paquetes)} {fila.paquetes === 1 ? "paquete" : "paquetes"}{fila.unidadesPaquete ? ` de ${numero.format(fila.unidadesPaquete)}` : ""}
                  {fila.sobrante > 0 && ` · te sobran ${numero.format(fila.sobrante)}`}
                </span>
                {/* Lo que usas frente a lo que compras (las dos cifras son de Python): se ve cuánto sobra del paquete. */}
                {comprados > 0 && fila.sobrante > 0 && (
                  <span aria-hidden="true" className="mt-1.5 block h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-superficie-2 ring-1 ring-borde-suave ring-inset">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ backgroundColor: hex === "#ffffff" ? "#9aa4b2" : hex }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, Math.round((fila.cantidad / comprados) * 100))}%` }}
                      transition={{ duration: DUR.larga, ease: EASE_SALIDA, delay: 0.15 }}
                    />
                  </span>
                )}
              </span>
              <span className="self-start pt-0.5 text-right text-sm font-semibold tabular-nums text-texto">{pesos.format(fila.subtotal)}</span>
            </motion.li>
          );
        })}
      </motion.ul>
      <div className="border-t border-borde-suave bg-superficie-suave px-4 py-3 @xl:px-5.5">
        <p className="text-xs text-texto-suave">Precio de tienda en línea, IVA incluido. No incluye el montaje.</p>
        {sobranteTotal > 0 && <p className="mt-1 text-xs text-texto-suave">Los globos se venden en paquetes cerrados; te sobran {numero.format(sobranteTotal)} para reponer los que se revienten.</p>}
      </div>
    </section>
  );
}
