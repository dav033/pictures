"use client";

import { motion } from "motion/react";
import { TarjetaCatalogo } from "@/components/catalogo/TarjetaCatalogo";
import type { ProductoExplorador } from "@/lib/shopify/consultas";

const contenedor = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] as const } },
};

/** Entrada escalonada al cargar la página o cambiar de filtro — antes el
 * grid entero aparecía de golpe, sin ninguna señal de que el contenido
 * cambió. La key en el contenedor (fuera de este componente, en la page)
 * fuerza que Motion trate un cambio de filtro como un montaje nuevo. */
export function GridCatalogo({ productos }: { productos: ProductoExplorador[] }) {
  return (
    <motion.div
      variants={contenedor}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
    >
      {productos.map((p) => (
        <motion.div key={p.productoId} variants={item}>
          <TarjetaCatalogo producto={p} />
        </motion.div>
      ))}
    </motion.div>
  );
}
