"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";

type PropsAsistente = {
  children: ReactNode;
  /** Solo el primero de una racha de mensajes seguidos del asistente lleva avatar; los demás dejan el hueco. */
  mostrarAvatar: boolean;
  /** Mientras llega el texto, el avatar respira con un halo. */
  transmitiendo: boolean;
  /** Va a `data-mensaje-id`, para que el autoscroll pueda llevar el mensaje a la vista por su cabecera. */
  id?: string;
};

export function BurbujaAsistente({ children, mostrarAvatar, transmitiendo, id }: PropsAsistente) {
  const reducido = useReducedMotion();
  return (
    <div data-mensaje-id={id} className="flex scroll-mt-4 gap-3">
      {mostrarAvatar ? (
        <span aria-hidden className="relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-acento-suave text-acento ring-1 ring-acento/20">
          {/* El halo va en su propia capa: el anillo de Tailwind también es box-shadow y se perdería. */}
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-full"
            animate={transmitiendo && !reducido ? { boxShadow: ["0 0 0 0px rgb(139 108 255 / 0.35)", "0 0 0 8px rgb(139 108 255 / 0)"] } : { boxShadow: "0 0 0 0px rgb(139 108 255 / 0)" }}
            transition={transmitiendo && !reducido ? { duration: 1.4, repeat: Infinity, ease: "easeOut" } : { duration: 0.2 }}
          />
          <Sparkles className="size-4" />
        </span>
      ) : (
        <span aria-hidden className="w-8 shrink-0" />
      )}
      <div className="min-w-0 flex-1 text-[0.95rem] leading-relaxed text-texto [&_.prose-chat]:text-[0.95rem]">{children}</div>
    </div>
  );
}

type PropsUsuario = {
  children: ReactNode;
  /** Miniatura (data URL) de la foto de inspiración que mandó, encima del texto. */
  miniatura?: string;
  id?: string;
};

export function BurbujaUsuario({ children, miniatura, id }: PropsUsuario) {
  return (
    <div data-mensaje-id={id} className="ml-auto flex max-w-[min(85%,36rem)] scroll-mt-4 flex-col items-end gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local en data URL */}
      {miniatura && <img src={miniatura} alt="Foto de inspiración enviada" className="h-28 w-auto rounded-2xl border border-borde-suave object-cover shadow-sm" />}
      <div className="rounded-[1.25rem] rounded-br-md bg-acento px-4 py-2.5 text-[0.95rem] text-sobre-acento shadow-[0_4px_14px_var(--sombra-acento)]">{children}</div>
    </div>
  );
}
