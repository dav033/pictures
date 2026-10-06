import { BadgeCheck, MapPin, Store } from "lucide-react";
import type { ProveedorSempertex } from "@/lib/biblioteca-sempertex/esquemas";

const TIPOS: Record<ProveedorSempertex["tipo"], string> = {
  decorador_happia: "Decorador certificado HAPPIA",
  mbp: "Master Balloon Pro",
  distribuidor: "Distribuidor Sempertex",
  ecommerce: "Tienda en línea",
};

/**
 * Decoradores y distribuidores de la ciudad del cliente. No enlaza a ninguna web: los registros de hoy son de ejemplo
 * (example.com en una presentación parecía un error); «Solicitar cotización» se resuelve dentro de la conversación.
 */
export function TarjetasProveedores({ proveedores, activo, onSolicitar }: { proveedores: readonly ProveedorSempertex[]; activo: boolean; onSolicitar: (proveedor: ProveedorSempertex) => void }) {
  if (!proveedores.length) return <p className="mt-3 rounded-2xl bg-superficie p-4 text-sm text-texto-secundario">Todavía no tengo decoradores registrados en esa ciudad.</p>;
  return <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Decoradores y distribuidores">
    {proveedores.map((proveedor) => {
      const decorador = proveedor.tipo === "decorador_happia" || proveedor.tipo === "mbp";
      return <article key={proveedor.id} className="flex flex-col rounded-2xl border border-borde-suave bg-superficie p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-acento-suave text-acento">
            {decorador ? <BadgeCheck className="size-5" aria-hidden /> : <Store className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-acento">{TIPOS[proveedor.tipo]}</p>
            <h3 className="mt-0.5 font-semibold leading-snug">{proveedor.nombre}</h3>
          </div>
          {proveedor.origen === "ejemplo" && <span className="rounded-full bg-acento-suave px-2 py-0.5 text-[0.7rem] font-semibold text-acento">Ejemplo</span>}
        </div>
        {proveedor.especialidad && <p className="mt-3 text-sm">{proveedor.especialidad}</p>}
        <p className="mb-4 mt-1 flex items-center gap-1.5 text-sm text-texto-secundario"><MapPin className="size-3.5" aria-hidden />{proveedor.zona.cobertura.join(" · ")}</p>
        {activo && <button type="button" onClick={() => onSolicitar(proveedor)} className="mt-auto rounded-xl bg-acento px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-acento-hover">
          {decorador ? "Solicitar cotización" : "Quiero comprar aquí"}
        </button>}
      </article>;
    })}
  </div>;
}
