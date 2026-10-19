"use client";

import { Info, LoaderCircle } from "lucide-react";
import type { ArmadoBouquetV1, DisposicionNumero, VarianteBouquet } from "@/lib/plan/armado-bouquet";
import type { OpcionesArmado } from "@/lib/plan/peticion-armado";
import { Apartado, Segmentado } from "../patron/controles-comunes";
import type { EstadoArranqueArmado, PedidoEstiloArmado } from "./arranque-armado";
import { ETIQUETA_DISPOSICION, ETIQUETA_VARIANTE } from "./leyenda-bouquet";

type Props = {
  /** El armado a la vista (el del decorador o la receta de Python); `null` mientras no hay ninguno. */
  borrador: ArmadoBouquetV1 | null;
  /** Estilos y disposiciones que Python admite para la pieza; `null` mientras no los dijo. */
  opciones: OpcionesArmado | null;
  /** Hay números en el armado a la vista: se ofrece dónde ponerlos. */
  conNumeros: boolean;
  estilo: EstadoArranqueArmado & { onElegir: (pedido: PedidoEstiloArmado) => void };
  /** Hay un globo elegido esperando al segundo. */
  eligiendo: boolean;
};

/**
 * Ajustes del armado (ADR-0030): el estilo y, con números, su disposición.
 * Exactamente lo que Python admite para la pieza (`opciones`); elegir otro
 * pide a Python su receta y esa respuesta pasa a ser el borrador. Los
 * intercambios de globos se hacen en la gráfica; aquí solo se explica.
 */
export function ControlesBouquet({ borrador, opciones, conNumeros, estilo, eligiendo }: Props) {
  const varianteActual = estilo.pendiente?.variante ?? borrador?.variante;
  const disposicionActual = estilo.pendiente?.disposicion ?? borrador?.numero?.disposicion;
  const variantes = opciones?.variantes ?? (varianteActual ? [varianteActual] : []);
  const disposiciones = opciones?.disposiciones ?? (disposicionActual ? [disposicionActual] : []);
  const ocupado = estilo.pendiente !== null;
  return (
    <div className="space-y-5">
      <Apartado titulo="Estilo" ayuda={varianteActual ? ETIQUETA_VARIANTE[varianteActual].ayuda : "Python arma cada estilo con los globos de la pieza."}>
        {variantes.length > 0 ? (
          <Segmentado<VarianteBouquet>
            etiqueta="Estilo del bouquet"
            opciones={variantes.map((variante) => ({ valor: variante, etiqueta: ETIQUETA_VARIANTE[variante].nombre }))}
            valor={varianteActual ?? variantes[0]!}
            onCambiar={(variante) => {
              if (variante === varianteActual && !estilo.error) return;
              estilo.onElegir({ variante });
            }}
          />
        ) : (
          <div className="brillo-carga h-9 w-64 max-w-full rounded-xl" aria-hidden="true" />
        )}
        <div role="status" aria-live="polite" className="min-h-4 text-xs text-texto-suave">
          {ocupado && <span className="inline-flex items-center gap-1.5"><LoaderCircle className="size-3 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />Armando ese estilo…</span>}
          {estilo.error && <span className="font-medium text-error">{estilo.error.mensaje}</span>}
        </div>
      </Apartado>

      {conNumeros && (
        <Apartado titulo="Números" ayuda="Dónde van los globos número.">
          {disposiciones.length > 0 ? (
            <Segmentado<DisposicionNumero>
              etiqueta="Disposición de los números"
              opciones={disposiciones.map((disposicion) => ({ valor: disposicion, etiqueta: ETIQUETA_DISPOSICION[disposicion] }))}
              valor={disposicionActual ?? disposiciones[0]!}
              onCambiar={(disposicion) => {
                if (!varianteActual || disposicion === disposicionActual) return;
                estilo.onElegir({ variante: varianteActual, disposicion });
              }}
            />
          ) : (
            <div className="brillo-carga h-9 w-56 max-w-full rounded-xl" aria-hidden="true" />
          )}
        </Apartado>
      )}

      <Apartado titulo="Intercambiar globos" ayuda="Elige un globo en la gráfica y luego otro: cambian de sitio. Los números solo entre sí.">
        <p className="flex items-start gap-1.5 text-xs text-texto-suave" aria-live="polite">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {eligiendo ? "Ahora elige el globo con el que lo intercambias." : "Cambiar un globo de una unidad lo cambia en todas las unidades iguales de ese nivel."}
        </p>
      </Apartado>
    </div>
  );
}
