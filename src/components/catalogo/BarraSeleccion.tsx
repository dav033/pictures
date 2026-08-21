"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useSeleccion } from "@/lib/estado/seleccion";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Sticky: refleja la selección compartida con el chat (§4.5 del plan). */
export function BarraSeleccion() {
  const { productos } = useSeleccion();
  const total = productos.reduce((suma, p) => suma + p.precio, 0);

  return (
    <AnimatePresence>
      {productos.length > 0 && (
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-borde bg-superficie px-5 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.06)]"
        >
          <span className="text-sm text-texto">
            <strong>{productos.length}</strong> pieza{productos.length === 1 ? "" : "s"} seleccionada
            {productos.length === 1 ? "" : "s"} · {pesos.format(total)}
          </span>
          <Link
            href="/"
            className="rounded-xl bg-acento px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Ir al chat a generar visualización
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
