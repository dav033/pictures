import Link from "next/link";
import { EstadisticasOrdenes } from "@/components/admin/EstadisticasOrdenes";
import { InterruptorTema } from "@/components/ui/interruptor-tema";

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
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Estadísticas del dataset</h1>
          <p className="text-sm text-texto-suave">Cobertura del catálogo, fotos, captions y alertas de entrenamiento.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Link href="/admin" className="ui-button-ghost rounded-lg px-2 py-1.5">
            Panel de administración
          </Link>
          <Link href="/" className="ui-button-ghost rounded-lg px-2 py-1.5">
            ← Volver al chat
          </Link>
          <InterruptorTema />
        </div>
      </div>
      <EstadisticasOrdenes />
    </main>
  );
}
