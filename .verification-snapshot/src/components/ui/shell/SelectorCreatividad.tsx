"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { NIVELES_CREATIVIDAD, parseNivelCreatividad, perfilCreatividad, type NivelCreatividad } from "@/lib/ia/escena/creatividad";

type Props = {
  valor: NivelCreatividad;
  onCambiar: (nivel: NivelCreatividad) => void;
};

/**
 * Creatividad compacta de la cabecera: desplegable accesible (Radix Select,
 * teclado y lector de pantalla) con los mismos niveles 0–5 de
 * src/lib/ia/escena/creatividad.ts. El disparador muestra solo el nombre del nivel;
 * cada opción suma su descripción de una línea.
 */
export function SelectorCreatividad({ valor, onCambiar }: Props) {
  const perfil = perfilCreatividad(valor);
  return (
    <SelectPrimitive.Root value={String(valor)} onValueChange={(nuevo) => onCambiar(parseNivelCreatividad(Number(nuevo)))}>
      <SelectPrimitive.Trigger
        id="nivel-creatividad"
        aria-label={`Creatividad: ${perfil.nombre}`}
        title={perfil.descripcion}
        data-testid="selector-creatividad"
        className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-[0.7rem] px-2 text-[0.8125rem] hover:bg-superficie-2 sm:px-2.5"
      >
        <span className="hidden text-texto-suave sm:inline">Creatividad</span>
        <span className="truncate font-medium text-texto">
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-texto-suave" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="end"
          sideOffset={6}
          className="radix-pop z-50 w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-[0.9rem] border border-borde-suave bg-superficie p-1 text-texto shadow-[0_16px_40px_var(--sombra)]"
        >
          <SelectPrimitive.Viewport>
            {NIVELES_CREATIVIDAD.map((nivel) => {
              const opcion = perfilCreatividad(nivel);
              return (
                <SelectPrimitive.Item
                  key={nivel}
                  value={String(nivel)}
                  className="relative flex cursor-pointer select-none flex-col rounded-[0.6rem] py-2 pl-8 pr-2.5 outline-none data-[highlighted]:bg-superficie-2"
                >
                  <span className="absolute left-2.5 top-2.5 flex size-3.5 items-center justify-center text-acento">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-3.5" aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <span className="text-sm font-medium">
                    <SelectPrimitive.ItemText>{opcion.nombre}</SelectPrimitive.ItemText>
                  </span>
                  <span className="text-xs leading-snug text-texto-suave">{opcion.descripcion}</span>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
