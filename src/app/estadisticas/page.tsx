import Link from "next/link";
import { EstadisticasOrdenes } from "@/components/admin/EstadisticasOrdenes";

/**
 * Acceso directo a las estadísticas del dataset, sin pasar por las pestañas del
 * panel de administración. El botón del chat apunta aquí.
 *
 * `instant = false`: los datos se leen en cada visita (carpeta local de órdenes
 * o snapshot publicado), no tiene sentido servir un shell estático.
 */
export const instant = false;

export default function EstadisticasPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Estadísticas del dataset</h1>
          <p className="text-sm text-texto-suave">Cobertura del catálogo, fotos, captions y alertas de entrenamiento.</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="text-texto-suave underline-offset-4 hover:underline">
            Panel de administración
          </Link>
          <Link href="/" className="text-texto-suave underline-offset-4 hover:underline">
            ← Volver al chat
          </Link>
        </div>
      </div>
      <EstadisticasOrdenes />
    </main>
  );
}
