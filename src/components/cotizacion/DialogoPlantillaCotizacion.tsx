"use client";

import { useId } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { RotateCcw, X } from "lucide-react";
import { SECCIONES, plantillaInicial, type CabeceraPlantilla, type CompraParaPlantilla } from "@/lib/cotizacion/plantilla";
import { useBorradorPlantillaCotizacion } from "@/lib/estado/borrador-plantilla-cotizacion";
import { SeccionPlantilla } from "@/components/cotizacion/SeccionPlantilla";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type Props = {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /**
   * Identidad de lo que se cotiza (el `plan_hash`). Mientras no cambie, lo que
   * la persona escribió sobrevive a cerrar y volver a abrir el diálogo.
   */
  clave: string;
  proyecto: string;
  /** Las compras del plan, que precargan las materias primas. */
  compras: readonly CompraParaPlantilla[];
};

/**
 * Hoy en `yyyy-mm-dd` y en la zona del navegador, que es la del decorador
 * (`toISOString` daría UTC y en Colombia adelantaría el día cada noche). El
 * módulo de cálculo no lee el reloj a propósito: la fecha entra como dato.
 */
function hoyLocal(): string {
  const ahora = new Date();
  const mes = `${ahora.getMonth() + 1}`.padStart(2, "0");
  const dia = `${ahora.getDate()}`.padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

type CampoCabecera = { campo: keyof CabeceraPlantilla; etiqueta: string; tipo: "text" | "date" | "tel"; modo?: "numeric" };

const CAMPOS_CABECERA: readonly CampoCabecera[] = [
  { campo: "proyecto", etiqueta: "Nombre del proyecto", tipo: "text" },
  { campo: "fecha", etiqueta: "Fecha", tipo: "date" },
  { campo: "contacto", etiqueta: "Nombre del contacto", tipo: "text" },
  { campo: "numero", etiqueta: "Cotización No.", tipo: "text", modo: "numeric" },
  { campo: "lugar", etiqueta: "Lugar", tipo: "text" },
  { campo: "celular", etiqueta: "Celular", tipo: "tel" },
];

const CAMPO = "mt-1 w-full rounded-lg border border-borde bg-fondo px-2.5 py-1.5 text-[13px] text-texto outline-none placeholder:text-texto-suave focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento";

/**
 * La hoja de cotización del proyecto: la plantilla con la que el decorador
 * cotiza de verdad, editable dentro de la app.
 *
 * Es un envoltorio. Las materias primas llegan precargadas desde las compras que
 * el plan ya firmó y se pueden corregir a mano; mano de obra, equipos y costos
 * indirectos arrancan vacíos porque la app no inventa esos importes. Toda la
 * aritmética vive en `@/lib/cotizacion/plantilla`; aquí solo se presenta.
 */
export function DialogoPlantillaCotizacion({ abierto, onAbiertoChange, clave, proyecto, compras }: Props) {
  const focoRetorno = useFocoDeRetorno();
  const reducir = useReducedMotion();
  const idBase = useId();
  const borrador = useBorradorPlantillaCotizacion(clave, () => plantillaInicial({ proyecto, fecha: hoyLocal(), compras }));
  const { plantilla, totales } = borrador;

  return (
    <Dialog.Root open={abierto} onOpenChange={onAbiertoChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-60 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content asChild aria-describedby={`${idBase}-intro`} {...focoRetorno}>
          <motion.div
            initial={reducir ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-2 bottom-2 top-auto z-60 mx-auto flex max-h-[calc(100dvh-1rem)] max-w-[62rem] flex-col overflow-hidden rounded-3xl border border-borde-suave bg-fondo shadow-[0_24px_64px_var(--sombra)] sm:inset-x-4 sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-3rem)] sm:-translate-y-1/2"
          >
            <div className="flex items-start justify-between gap-4 border-b border-borde-suave bg-superficie px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-acento">Cotización del proyecto</p>
                <Dialog.Title className="mt-0.5 text-lg font-semibold tracking-tight text-texto sm:text-xl">{plantilla.cabecera.proyecto || "Nueva cotización"}</Dialog.Title>
                <p id={`${idBase}-intro`} className="mt-1 text-[13px] text-texto-suave">
                  Los globos ya vienen puestos desde el plan. Mano de obra, equipos y costos indirectos los pones tú.
                </p>
              </div>
              <Dialog.Close className="grid size-10 shrink-0 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento" aria-label="Cerrar la cotización del proyecto">
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
              <section aria-labelledby={`${idBase}-cabecera`} className="rounded-2xl border border-borde-suave bg-superficie p-3 sm:p-4">
                <h3 id={`${idBase}-cabecera`} className="text-sm font-semibold text-texto">Datos de la cotización</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {CAMPOS_CABECERA.map(({ campo, etiqueta, tipo, modo }) => (
                    <label key={campo} className="block text-xs font-medium text-texto-suave">
                      {etiqueta}
                      <input
                        type={tipo}
                        inputMode={modo}
                        value={plantilla.cabecera[campo]}
                        onChange={(evento) => borrador.cambiarCabecera(campo, evento.target.value)}
                        autoComplete="off"
                        className={CAMPO}
                      />
                    </label>
                  ))}
                </div>
              </section>

              {(["directos", "indirectos"] as const).map((grupo) => (
                <section key={grupo} aria-labelledby={`${idBase}-${grupo}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                    <h3 id={`${idBase}-${grupo}`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-texto-suave">
                      {grupo === "directos" ? "Costos directos" : "Costos indirectos"}
                    </h3>
                    <p className="text-xs text-texto-suave">
                      <span className="font-semibold tabular-nums text-texto">{pesos.format(grupo === "directos" ? totales.costosDirectos : totales.costosIndirectos)}</span>
                    </p>
                  </div>
                  <div className="mt-2 space-y-3">
                    {SECCIONES.filter((seccion) => seccion.grupo === grupo).map((seccion) => (
                      <SeccionPlantilla
                        key={seccion.clave}
                        seccion={seccion}
                        filas={plantilla.secciones[seccion.clave]}
                        subtotal={totales.subtotales[seccion.clave]}
                        nota={seccion.clave === "materias" ? "Precargadas desde los globos del plan, con el precio y los paquetes que ya calculó. Corrígelas si tu factura dice otra cosa." : undefined}
                        onAnadir={() => borrador.anadirFila(seccion.clave)}
                        onCambiar={(id, cambio) => borrador.cambiarFila(seccion.clave, id, cambio)}
                        onBorrar={(id) => borrador.borrarFila(seccion.clave, id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="border-t border-borde-suave bg-superficie px-4 pb-4 pt-3 sm:px-6">
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 sm:justify-end">
                <dt className="text-[13px] text-texto-suave sm:text-right">Total costos</dt>
                <dd className="text-right text-[13px] font-medium tabular-nums text-texto sm:w-40">{pesos.format(totales.totalCostos)}</dd>

                <dt className="flex items-center gap-2 text-[13px] text-texto-suave sm:justify-end">
                  <label htmlFor={`${idBase}-utilidad`}>Utilidad</label>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-borde bg-fondo pr-2">
                    <input
                      id={`${idBase}-utilidad`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="decimal"
                      value={plantilla.utilidadPorcentaje}
                      onFocus={(evento) => evento.currentTarget.select()}
                      onChange={(evento) => borrador.cambiarUtilidad(Number(evento.target.value))}
                      className="w-16 rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-[13px] tabular-nums text-texto outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
                    />
                    <span aria-hidden="true" className="text-xs text-texto-suave">%</span>
                  </span>
                </dt>
                <dd className="text-right text-[13px] font-medium tabular-nums text-texto sm:w-40">{pesos.format(totales.utilidad)}</dd>

                <dt className="border-t border-borde pt-2 text-sm font-semibold text-texto sm:text-right">Total proyecto</dt>
                <dd aria-live="polite" className="border-t border-borde pt-2 text-right text-2xl font-semibold tracking-tight tabular-nums text-texto sm:w-40">{pesos.format(totales.totalProyecto)}</dd>
              </dl>

              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={borrador.reiniciar}
                  className="inline-flex h-9 items-center gap-1.5 self-start rounded-xl px-2.5 text-xs font-medium text-texto-suave hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Empezar de nuevo
                </button>
                <Dialog.Close className="ui-pressable inline-flex h-11 items-center justify-center rounded-[0.8rem] bg-acento px-4 text-sm font-semibold text-sobre-acento hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  Listo
                </Dialog.Close>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
