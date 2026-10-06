import { DecoracionSempertexSchema, type DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

/**
 * Decoración fija para las pruebas de cotización de la vista guiada: tres variantes R-12 reales (Palo de rosa,
 * Durazno, Blanco) con 40/20/20 globos. Antes las pruebas buscaban «ej-cumpleanos-estrellas» en la biblioteca y se
 * rompían cuando la biblioteca cambiaba de temáticas (2026-10-06).
 */
export const DECORACION_DEMO_COTIZACION: DecoracionSempertex = DecoracionSempertexSchema.parse({
  id: "ej-demo-cotizacion", origen: "ejemplo", aviso: "DATO DE EJEMPLO — no es real",
  titulo: "Demo de cotización", tematica: "Palo de rosa, durazno y blanco", eventos: ["cumpleaños"], edad: null,
  fotos: [{ url: "/biblioteca-sempertex/kits/e-decor-amor.jpg", fuente: "Prueba", licencia: "sempertex_propia" }], video: null,
  piezas: [{ estructura: "arco_asimetrico", cantidad: 1 }, { estructura: "bouquet", cantidad: 2 }],
  materiales: [
    { variantId: "50030991311143", sku: null, cantidad: 40, nota: "Globo látex R-12 Rosewood, paquete x50; cantidad sugerida de ejemplo." },
    { variantId: "46594211053863", sku: null, cantidad: 20, nota: "Globo látex R-12 Durazno, paquete x50; cantidad sugerida de ejemplo." },
    { variantId: "46594221343015", sku: null, cantidad: 20, nota: "Globo látex R-12 Blanco, paquete x50; cantidad sugerida de ejemplo." },
  ],
  pasos: [], shopifyHandle: null,
});
