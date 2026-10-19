"use client";

import { Check, Info, TriangleAlert } from "lucide-react";
import type { ColorLeyenda } from "@/components/plan/patron/leyenda";
import type { Comparacion, OrigenApertura } from "./pieza-desde-plan";

/**
 * Lo que el cliente necesita saber al abrir «Modificar esta pieza» de una pieza que todavía no tenía armado (probador
 * 124, hallazgo 3): si el dibujo lleva lo mismo que su plan o en qué se aparta, que su plan no cambia mientras no
 * guarde y que, si guarda, la pieza se queda con los globos del dibujo. Con un cambio a la vista, cuántos globos
 * tendría. Presentación pura: recibe la comparación ya hecha (`compararConPlan`) y no cuenta nada.
 */

const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

function globos(cantidad: number): string {
  return `${entero.format(cantidad)} ${cantidad === 1 ? "globo" : "globos"}`;
}

/** «Rosado 15 · Lila 14 · Dorado 10», con los nombres de la leyenda de la pieza. */
export function coloresEnTexto(filas: ReadonlyArray<{ material: number; globos: number }>, leyenda: readonly ColorLeyenda[]): string {
  return filas.map((fila) => `${leyenda[fila.material]?.etiqueta ?? `Color ${fila.material + 1}`} ${entero.format(fila.globos)}`).join(" · ");
}

function pulgadas(tamanos: readonly number[]): string {
  if (!tamanos.length) return "";
  const lista = tamanos.map((tamano) => String(tamano));
  return `${lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}` : lista[0]}″`;
}

function mismosTamanos(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((tamano, indice) => tamano === b[indice]);
}

type Props = {
  /** Comparación del dibujo con el plan; null mientras no hay dibujo vigente. */
  comparacion: Comparacion | null;
  /** Cómo abrió el editor: con las cifras del plan o con el diseño base (receta). */
  origen: Exclude<OrigenApertura, "guardado">;
  /** «la columna orgánica izquierda», «el arco». */
  pieza: string;
  leyenda: readonly ColorLeyenda[];
  /** Hay un cambio sin guardar: se dice cuántos globos quedarían. */
  hayCambios: boolean;
  /** Globos del plan que el editor no dibuja (otra forma u otro tamaño). */
  fueraDelMotor: number;
};

export function AvisoPiezaPlan({ comparacion, origen, pieza, leyenda, hayCambios, fueraDelMotor }: Props) {
  if (!comparacion) return null;
  const { plan, dibujo } = comparacion;
  const fuera = fueraDelMotor > 0 ? ` Tu plan lleva además ${globos(fueraDelMotor)} que este editor no dibuja.` : "";
  if (hayCambios) {
    return (
      <p role="status" data-testid="aviso-pieza-plan" data-estado="cambios" className="flex items-start gap-2 rounded-xl bg-superficie px-3 py-2 text-xs text-texto ring-1 ring-borde-suave ring-inset">
        <Info className="mt-px size-3.5 shrink-0 text-acento" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Si guardas, {pieza} pasa de {globos(plan.total)} a <strong className="font-semibold">{globos(dibujo.total)}</strong>
          {dibujo.porMaterial.length > 1 ? ` (${coloresEnTexto(dibujo.porMaterial, leyenda)})` : ""}.{fuera}
        </span>
      </p>
    );
  }
  if (comparacion.exacta) {
    return (
      <p role="status" data-testid="aviso-pieza-plan" data-estado="igual" className="flex items-start gap-2 rounded-xl bg-superficie px-3 py-2 text-xs text-texto-suave ring-1 ring-borde-suave ring-inset">
        <Check className="mt-px size-3.5 shrink-0 text-exito" aria-hidden="true" />
        <span className="min-w-0 flex-1">El dibujo lleva lo mismo que tu plan: {globos(plan.total)}{plan.porMaterial.length > 1 ? ` (${coloresEnTexto(plan.porMaterial, leyenda)})` : ""}.</span>
      </p>
    );
  }
  const tamanos = !mismosTamanos(plan.tamanos, dibujo.tamanos) && plan.tamanos.length && dibujo.tamanos.length
    ? ` Tamaños: tu plan lleva de ${pulgadas(plan.tamanos)}; el dibujo, de ${pulgadas(dibujo.tamanos)}.`
    : "";
  return (
    <div role="status" data-testid="aviso-pieza-plan" data-estado={origen === "plan" ? "parecido" : "base"} className="space-y-1 rounded-xl bg-aviso-suave px-3 py-2.5 text-xs text-aviso">
      <p className="flex items-start gap-2 font-semibold">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {origen === "plan" ? "El dibujo se parece a tu plan, pero no es idéntico" : `No pude dibujar ${pieza} con las medidas y los globos de tu plan`}
        </span>
      </p>
      <p className="pl-5.5 leading-relaxed">
        {origen === "plan" ? "" : "Ves el diseño base del editor. "}
        Tu plan: {globos(plan.total)}{plan.porMaterial.length > 1 ? ` (${coloresEnTexto(plan.porMaterial, leyenda)})` : ""}. El dibujo: {globos(dibujo.total)}{dibujo.porMaterial.length > 1 ? ` (${coloresEnTexto(dibujo.porMaterial, leyenda)})` : ""}.{tamanos}{fuera}
      </p>
      <p className="pl-5.5 leading-relaxed">Tu plan no cambia mientras no guardes. Si guardas un cambio, {pieza} se queda con los globos del dibujo.</p>
    </div>
  );
}

/** La pregunta antes de reescribir la pieza con los globos del dibujo. */
export function ConfirmarPiezaPlan({ pieza, antes, despues, leyenda, onGuardar, onSeguir }: {
  pieza: string;
  antes: number;
  despues: { total: number; porMaterial: ReadonlyArray<{ material: number; globos: number }> };
  leyenda: readonly ColorLeyenda[];
  onGuardar: () => void;
  onSeguir: () => void;
}) {
  return (
    <div role="alertdialog" aria-labelledby="confirmar-pieza-plan-titulo" aria-describedby="confirmar-pieza-plan-detalle" data-testid="confirmar-pieza-plan" className="space-y-2.5">
      <p id="confirmar-pieza-plan-titulo" className="text-sm font-semibold text-texto">¿Guardo {pieza} con {globos(despues.total)}?</p>
      <p id="confirmar-pieza-plan-detalle" className="text-xs leading-relaxed text-texto-suave">
        Tu plan tiene {globos(antes)}. Al guardar, {pieza} se queda con los globos del dibujo
        {despues.porMaterial.length > 1 ? ` (${coloresEnTexto(despues.porMaterial, leyenda)})` : ""} y recalculo el precio.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onGuardar} data-testid="confirmar-pieza-plan-guardar" className="ui-button-primary ui-pressable min-h-11 px-4 text-[13px]">Sí, guardar con {globos(despues.total)}</button>
        <button type="button" onClick={onSeguir} data-testid="confirmar-pieza-plan-seguir" className="ui-button-secondary ui-pressable min-h-11 px-4 text-[13px]">Seguir editando</button>
      </div>
    </div>
  );
}
