import type { HappiaPackage } from "@sempertex/happie-package-ia";
import type { HappieCatalogRecommendation } from "@/lib/ia/contracts/happie-v2";
import { ListaRecomendaciones } from "./PaqueteCard";

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(value);

export function CatalogResults({ recommendations, idsEnCarrito, onAgregar }: {
  recommendations: HappieCatalogRecommendation[];
  idsEnCarrito: Set<string>;
  onAgregar: (paquete: HappiaPackage) => void;
}) {
  const services = recommendations.filter((r) => r.tipo === "servicio");
  const packages = recommendations.filter((r) => r.tipo === "paquete");
  if (!recommendations.length) return null;
  return <div className="flex flex-col gap-6">
    {services.length > 0 && <section aria-label="Servicios recomendados" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-texto">Servicios · {services.length}</h2>
      {services.map(({ servicio, razon, precio }) => <article key={servicio.id} className="rounded-2xl border border-borde bg-superficie p-5">
        <p className="text-xs text-acento">Servicio · {servicio.category_name}</p>
        <h3 className="mt-1 font-semibold text-texto">{servicio.name ?? servicio.category_name}</h3>
        <p className="mt-2 text-sm text-texto-suave">{razon}</p>
        {servicio.description && <p className="mt-2 whitespace-pre-line text-sm text-texto">{servicio.description}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-texto-suave">Proveedor</dt><dd>{servicio.provider_name}</dd>
          <dt className="text-texto-suave">Ciudad</dt><dd>{servicio.city}</dd>
          <dt className="text-texto-suave">Precio base</dt><dd>{money(servicio.total)} {servicio.charge_mode === "per_person" ? "por persona" : servicio.charge_mode === "event" ? "por evento" : `por ${servicio.sale_unit?.singular ?? "unidad"}`}</dd>
          <dt className="text-texto-suave">Estimado</dt><dd>{precio.subtotal === null ? "Por confirmar" : money(precio.subtotal)}</dd>
          {servicio.rating && <><dt className="text-texto-suave">Calificación</dt><dd>{servicio.rating.average} / 5 · {servicio.rating.count} opiniones</dd></>}
        </dl>
        <p className="mt-3 text-xs text-texto-suave">{precio.advertencia}</p>
        {servicio.has_delivery && <p className="mt-1 text-xs text-texto-suave">El proveedor cobra domicilio adicional según la ubicación.</p>}
      </article>)}
    </section>}
    {packages.length > 0 && <section aria-label="Paquetes recomendados" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-texto">Paquetes · {packages.length}</h2>
      <ListaRecomendaciones recomendaciones={packages} idsEnCarrito={idsEnCarrito} onAgregar={onAgregar} />
      {packages.map(({ paquete, precio }) => <p key={paquete.id} className="text-xs text-texto-suave">
        {paquete.name}: {precio.subtotal === null ? "Importe por confirmar" : `Estimado ${money(precio.subtotal)}`}. {precio.advertencia}
      </p>)}
    </section>}
    <p className="text-xs text-texto-suave">Son opciones recomendadas; su suma no constituye una cotización final. IVA, comisión de Happia y domicilios se calculan al finalizar la compra.</p>
  </div>;
}
