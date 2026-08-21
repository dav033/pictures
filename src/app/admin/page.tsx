import { connection } from "next/server";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { obtenerDecoraciones } from "@/lib/decoraciones";
import { obtenerProductos } from "@/lib/products";

// `cacheComponents` (next.config.ts) solo detecta como "dinámico" el acceso a
// fetch/cookies/headers/etc. Las lecturas de node:sqlite son invisibles para
// esa detección, así que sin connection() esta página se prerenderiza como
// estática en el build y queda congelada con el snapshot de ese momento —
// exactamente lo que este archivo advertía evitar antes de cacheComponents.
// `instant = false`: es una página de administración leída en cada visita,
// no tiene sentido servir un shell estático — se acepta el bloqueo.
export const instant = false;

export default async function AdminPage() {
  await connection();
  const [productos, decoraciones] = await Promise.all([
    obtenerProductos(),
    obtenerDecoraciones(),
  ]);

  return <AdminTabs productosIniciales={productos} decoracionesIniciales={decoraciones} />;
}
