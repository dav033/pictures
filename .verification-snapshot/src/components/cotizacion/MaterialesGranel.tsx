"use client";

import { useCallback, useEffect, useRef } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { estadoPrecioUnidad, leerGlobosExtra, type BorradorGranel, type GranelLeido, type UnidadesMaterial } from "@/lib/cotizacion/granel";
import type { CotizacionProfesionalResultado, LineaMaterialProfesional } from "@/lib/cotizacion/profesional";
import { registrarEventoCliente } from "@/lib/registro/cliente";
import { BaldosaGlobo } from "@/components/guiado/GloboMiniatura";
import { fichaGlobo, type FichaGlobo } from "@/components/guiado/ficha-globo";
import { partesLinea } from "@/components/guiado/formato";
import { Campo, MensajesDeError } from "./Campo";
import { CLASE_NO_VIGENTE, importeOGuion, numero, pesos } from "./formato";

type LineaResultado = CotizacionProfesionalResultado["materiales"]["lineas"][number];
type ResumenGranel = NonNullable<CotizacionProfesionalResultado["materiales"]["granel"]>;

type Props = {
  clave: string;
  materiales: readonly LineaMaterialProfesional[];
  unidades: Readonly<Record<string, UnidadesMaterial>>;
  /** Cómo se ve cada globo (foto, color, acabado, tamaño), por variante; sin ella se deduce del nombre. */
  fichas?: Readonly<Record<string, FichaGlobo>>;
  borrador: BorradorGranel;
  leido: GranelLeido;
  /** La línea que calculó Python para cada variante (con su `granel`), o `null` mientras no hay una. */
  lineaDe: (variantId: string) => LineaResultado | null;
  resumen: ResumenGranel | null;
  totalPaquetes: number | null;
  atenuar: boolean;
  onPrecio: (variantId: string, texto: string | null) => void;
  onExtra: (variantId: string, texto: string) => void;
};

/** Espera tras la última tecla antes de dejar en el registro una edición (una línea por edición, no por tecla). */
const ESPERA_REGISTRO_MS = 1200;

/** Registra una edición cuando se deja de teclear; lo pendiente se envía igual si la tarjeta se desmonta. */
function useRegistroDiferido(): (clave: string, evento: string, datos: Record<string, unknown>) => void {
  const pendientes = useRef(new Map<string, { temporizador: number; evento: string; datos: Record<string, unknown> }>());
  useEffect(() => {
    const mapa = pendientes.current;
    return () => {
      for (const { temporizador, evento, datos } of mapa.values()) {
        window.clearTimeout(temporizador);
        registrarEventoCliente(evento, datos, "activa");
      }
      mapa.clear();
    };
  }, []);
  return useCallback((clave, evento, datos) => {
    const mapa = pendientes.current;
    const previa = mapa.get(clave);
    if (previa) window.clearTimeout(previa.temporizador);
    const temporizador = window.setTimeout(() => {
      mapa.delete(clave);
      registrarEventoCliente(evento, datos, "activa");
    }, ESPERA_REGISTRO_MS);
    mapa.set(clave, { temporizador, evento, datos });
  }, []);
}

/**
 * Los globos sueltos, a granel: por globo (color y tamaño) exactamente las
 * unidades del plan, su costo por globo editable (de partida, el del paquete
 * ÷ sus unidades, marcado como estimado) y los globos extra que el decorador
 * agrega para vender. Cada precio de partida, subtotal, sobrante y total es
 * de Python; aquí solo se escribe y se muestra.
 */
export function MaterialesGranel({ clave, materiales, unidades, fichas, borrador, leido, lineaDe, resumen, totalPaquetes, atenuar, onPrecio, onExtra }: Props) {
  const registrar = useRegistroDiferido();
  const claseImporte = (valor: number | null) => (atenuar && valor !== null ? CLASE_NO_VIGENTE : "");
  return (
    <section aria-label="Globos a granel" data-testid="materiales-granel" className="px-4 pb-4 @xl:px-5.5">
      <ul className="rounded-2xl bg-superficie ring-1 ring-borde-suave ring-inset" aria-label="Globos sueltos por color y tamaño">
        {materiales.map((material) => {
          const id = material.variant_id;
          const ficha = fichas?.[id] ?? fichaGlobo({ nombre: material.descripcion });
          const esGlobo = partesLinea({ nombre: material.descripcion }).esGlobo;
          const nombre = [ficha.producto, ficha.medida].filter(Boolean).join(" · ");
          const linea = lineaDe(id);
          const granel = linea?.granel ?? null;
          const plan = unidades[id]?.unidades_plan ?? 0;
          const escrito = borrador.preciosUnidad[id];
          const estado = estadoPrecioUnidad(escrito);
          const editado = estado === "propio" && (granel ? granel.precio_unidad_editado : true);
          const extraTexto = borrador.extras[id] ?? "";
          const extra = leerGlobosExtra(extraTexto) ?? 0;
          const errorPrecio = leido.erroresPrecio[id];
          const errorExtra = leido.erroresExtra[id];
          const idPrecio = `granel-precio-${clave}-${id}`;
          const idExtra = `granel-extra-${clave}-${id}`;
          const palabra = (n: number) => (esGlobo ? (n === 1 ? "globo" : "globos") : (n === 1 ? "unidad" : "unidades"));
          const base = granel?.precio_unidad_base_cop ?? null;
          const cambiarPrecio = (texto: string | null) => {
            onPrecio(id, texto);
            registrar(`precio:${id}`, "cotizacion.granel.precio_unidad", { clave, variant_id: id, texto, precioBase: base, restablecer: texto === null });
          };
          return (
            <li key={id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 border-b border-borde-suave px-3 py-3.5 last:border-b-0 @md:items-start">
              <BaldosaGlobo hex={ficha.hex} acabado={ficha.acabado} pulgadas={ficha.pulgadas} foto={ficha.foto} tamano={44} />
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-[13px] font-medium leading-5 text-texto">{nombre}</span>
                  <span className={`shrink-0 text-[13px] font-semibold leading-5 tabular-nums text-texto ${claseImporte(granel?.subtotal_cop ?? null)}`}>{importeOGuion(granel?.subtotal_cop ?? null)}</span>
                </div>
                <p className="text-xs leading-5 text-texto-suave">
                  {numero.format(plan)} del plan{extra > 0 && <> + <span className="font-medium text-acento">{numero.format(extra)} extra</span></>}
                  {granel && <> = {numero.format(granel.unidades)} {palabra(granel.unidades)} × {pesos.format(granel.precio_unidad_cop)}</>}
                </p>
              </div>
              {/* En el teléfono los campos usan todo el ancho de la fila; con espacio, van bajo el nombre. */}
              <div className="col-span-2 min-w-0 @md:col-span-1 @md:col-start-2">
                <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 @md:mt-2">
                  <Campo
                    id={idPrecio}
                    tipo="pesos"
                    derecha
                    etiqueta={esGlobo ? "Por globo" : "Por unidad"}
                    nombre={`Costo por ${esGlobo ? "globo" : "unidad"} de ${nombre}`}
                    valor={escrito !== undefined ? escrito : base !== null ? numero.format(base) : ""}
                    onValor={(texto) => cambiarPrecio(texto)}
                    error={errorPrecio}
                    destacado={editado}
                  />
                  <GlobosExtra
                    id={idExtra}
                    nombre={nombre}
                    valor={extraTexto}
                    error={errorExtra}
                    onValor={(texto) => {
                      onExtra(id, texto);
                      registrar(`extra:${id}`, "cotizacion.granel.globos_extra", { clave, variant_id: id, texto });
                    }}
                  />
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-5 text-texto-suave">
                  {editado ? (
                    <>
                      <span className="font-medium text-acento">Tu precio por {esGlobo ? "globo" : "unidad"}</span>
                      {base !== null && (
                        <button type="button" onClick={() => cambiarPrecio(null)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-1 font-medium text-texto underline decoration-borde underline-offset-2 hover:text-acento focus-visible:outline-2 focus-visible:outline-acento">
                          <RotateCcw className="size-3" aria-hidden="true" />
                          Volver a {pesos.format(base)}
                        </button>
                      )}
                    </>
                  ) : granel && !granel.precio_unidad_estimado ? (
                    <span>Precio de la unidad en el catálogo</span>
                  ) : granel ? (
                    <span>
                      <span className="mr-1 rounded-full bg-aviso-suave px-1.5 py-px text-[11px] font-medium text-aviso">estimado</span>
                      Precio por unidad estimado del paquete: {pesos.format(linea?.precio_paquete_cop ?? 0)} ÷ {numero.format(granel.unidades_paquete)}
                    </span>
                  ) : null}
                </p>
                {granel && granel.sobrante_paquetes > 0 && (
                  <p className="text-xs leading-5 text-texto-suave">
                    Por paquete: {numero.format(linea?.paquetes ?? 0)} de {numero.format(granel.unidades_paquete)} y te sobrarían {numero.format(granel.sobrante_paquetes)}.
                  </p>
                )}
                <MensajesDeError mensajes={[...(errorPrecio ? [{ id: idPrecio, texto: errorPrecio }] : []), ...(errorExtra ? [{ id: idExtra, texto: errorExtra }] : [])]} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1 rounded-2xl bg-acento-suave/60 px-3.5 py-3 ring-1 ring-acento/20 ring-inset">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-texto">Total a granel</span>
          {resumen && (
            <span className="block text-xs text-texto-suave">
              {numero.format(resumen.unidades)} globos sueltos{resumen.unidades_extra > 0 ? ` (${numero.format(resumen.unidades_extra)} extra)` : ""}
            </span>
          )}
        </span>
        <span className={`text-xl font-semibold tracking-tight tabular-nums text-texto ${claseImporte(resumen?.total_cop ?? null)}`}>{importeOGuion(resumen?.total_cop ?? null)}</span>
        {resumen && totalPaquetes !== null && (
          <p className={`col-span-2 text-xs leading-5 text-texto-suave ${claseImporte(totalPaquetes)}`}>
            Comprando paquetes cerrados pagarías {pesos.format(totalPaquetes)}{resumen.sobrante_paquetes > 0 ? ` y te sobrarían ${numero.format(resumen.sobrante_paquetes)} globos` : ""}.
          </p>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-texto-suave">El precio estimado divide el precio del paquete entre sus globos; escribe el tuyo si tu proveedor te los vende sueltos a otro precio.</p>
    </section>
  );
}

/** Globos extra para vender: − y + de a uno, o escrito. Vacío es ninguno. */
function GlobosExtra({ id, nombre, valor, error, onValor }: { id: string; nombre: string; valor: string; error: string | undefined; onValor: (texto: string) => void }) {
  const actual = leerGlobosExtra(valor);
  const boton = "grid w-9 shrink-0 place-items-center text-texto-suave hover:bg-acento-suave hover:text-acento disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento";
  return (
    <div className={`relative flex h-11 w-[7.5rem] overflow-hidden rounded-lg border bg-fondo ${error ? "border-error" : actual ? "border-acento" : "border-borde"}`}>
      <button type="button" className={boton} aria-label={`Un globo extra menos de ${nombre}`} disabled={!actual} onClick={() => onValor(actual && actual > 1 ? String(actual - 1) : "")}>
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <span className="relative min-w-0 flex-1">
        <label htmlFor={id} className="pointer-events-none absolute inset-x-0 top-1 text-center text-[11px] leading-3 text-texto-suave">Extra</label>
        <input
          id={id}
          inputMode="numeric"
          aria-label={`Globos extra para vender de ${nombre}`}
          aria-invalid={Boolean(error)}
          aria-errormessage={error ? `${id}-error` : undefined}
          value={valor}
          placeholder="0"
          maxLength={7}
          onChange={(evento) => onValor(evento.target.value.replace(/[^\d]/g, ""))}
          className="h-full w-full bg-transparent pb-1 pt-4 text-center text-[13px] tabular-nums text-texto outline-none placeholder:text-texto-suave"
        />
      </span>
      <button type="button" className={boton} aria-label={`Un globo extra más de ${nombre}`} disabled={actual === null} onClick={() => onValor(String((actual ?? 0) + 1))}>
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
