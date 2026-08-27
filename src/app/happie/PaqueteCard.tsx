import { Plus, Check, Sparkles, Users, Clock } from "lucide-react";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import { ArtePaquete } from "./Tema";

/** Varios `package_items` llegan sin `description`; se usa `category_name`
 * como respaldo y se deduplica para no repetir la misma categoría varias
 * veces (ver ítems de "Cumpleaños Neón"/"Cumpleaños Luxury"). */
function etiquetasItems(paquete: HappiaPackage): string[] {
  const etiquetas = paquete.package_items
    .map((item) => item.description ?? item.category_name)
    .filter((etiqueta): etiqueta is string => Boolean(etiqueta));
  return [...new Set(etiquetas)];
}

function proveedores(paquete: HappiaPackage): string[] {
  return [...new Set(paquete.package_items.map((item) => item.provider_name).filter((p): p is string => Boolean(p)))];
}

function Meta({ paquete }: { paquete: HappiaPackage }) {
  return (
    <div className="flex gap-4">
      <span className="flex items-center gap-1.5 text-xs text-texto-suave">
        <Users className="h-3.5 w-3.5 text-acento" />
        <strong className="font-semibold text-texto">{paquete.base_guests}</strong> invitados base
      </span>
      {paquete.standard_duration_minutes && (
        <span className="flex items-center gap-1.5 text-xs text-texto-suave">
          <Clock className="h-3.5 w-3.5 text-acento" />
          <strong className="font-semibold text-texto">{paquete.standard_duration_minutes}</strong> min
        </span>
      )}
    </div>
  );
}

/** La recomendación #1 de la IA se lleva el escenario: tarjeta horizontal,
 * arte grande, badge y el detalle completo. Las alternativas van en grilla
 * compacta — presentes, pero claramente secundarias (ver `PaqueteCompacta`). */
export function PaqueteHero({
  paquete,
  razon,
  enCarrito,
  onAgregar,
}: {
  paquete: HappiaPackage;
  razon?: string;
  enCarrito: boolean;
  onAgregar: (paquete: HappiaPackage) => void;
}) {
  const etiquetas = etiquetasItems(paquete);
  const provs = proveedores(paquete);

  return (
    <div className="happie-tarjeta happie-entra flex overflow-hidden rounded-[20px] border border-borde bg-superficie shadow-[0_4px_16px_var(--sombra)]">
      <ArtePaquete nombre={paquete.name} className="relative w-[220px] shrink-0 sm:w-[260px]">
        <div className="absolute left-3.5 top-3.5 flex items-center gap-1.5 rounded-full bg-[rgba(28,20,37,0.62)] px-2.5 py-1 backdrop-blur-sm">
          <Sparkles className="h-2.5 w-2.5 fill-[#fbbf24] text-[#fbbf24]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white">Mejor opción</span>
        </div>
      </ArtePaquete>

      <div className="flex flex-grow flex-col gap-3.5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight text-texto sm:text-[21px]">{paquete.name}</h2>
            {razon && <p className="max-w-md text-[13.5px] leading-relaxed text-texto-suave text-pretty">{razon}</p>}
          </div>
          <button
            onClick={() => onAgregar(paquete)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold"
            style={
              enCarrito
                ? { background: "var(--acento-suave)", borderColor: "var(--acento-suave)", color: "var(--acento)" }
                : { background: "#ffffff", borderColor: "var(--acento)", color: "var(--acento)" }
            }
          >
            {enCarrito ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />}
            {enCarrito ? "Agregado" : "Agregar"}
          </button>
        </div>

        <Meta paquete={paquete} />

        {etiquetas.length > 0 && (
          <>
            <div className="h-px bg-acento-suave" />
            <div className="flex flex-col gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-texto-suave">Qué incluye</span>
              <div className="flex flex-wrap gap-1.5">
                {etiquetas.map((etiqueta) => (
                  <span
                    key={etiqueta}
                    className="rounded-full border border-borde bg-superficie px-2.5 py-1 text-xs text-texto"
                  >
                    {etiqueta}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {provs.length > 0 && (
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[11.5px] text-texto-suave">Por</span>
            <div className="flex flex-wrap gap-1.5">
              {provs.map((prov) => (
                <span key={prov} className="rounded-md bg-superficie-2 px-2 py-0.5 text-[11px] font-medium text-texto-suave">
                  {prov}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PaqueteCompacta({
  paquete,
  razon,
  enCarrito,
  onAgregar,
  retraso = 0,
}: {
  paquete: HappiaPackage;
  razon?: string;
  enCarrito: boolean;
  onAgregar: (paquete: HappiaPackage) => void;
  retraso?: number;
}) {
  const etiquetas = etiquetasItems(paquete);

  return (
    <div
      className="happie-tarjeta happie-entra flex flex-col overflow-hidden rounded-[18px] border border-borde bg-superficie shadow-[0_2px_10px_var(--sombra)]"
      style={{ animationDelay: `${retraso}s` }}
    >
      <ArtePaquete nombre={paquete.name} className="h-[128px] w-full" />
      <div className="flex flex-grow flex-col gap-2.5 p-4 pb-5">
        <h3 className="text-[16px] font-semibold text-texto">{paquete.name}</h3>
        {razon && <p className="flex-grow text-[13px] leading-relaxed text-texto-suave text-pretty">{razon}</p>}
        <Meta paquete={paquete} />
        {etiquetas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {etiquetas.map((etiqueta) => (
              <span key={etiqueta} className="rounded-full bg-superficie-2 px-2 py-1 text-[11px] text-texto-suave">
                {etiqueta}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={() => onAgregar(paquete)}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[13px] font-semibold"
          style={
            enCarrito
              ? { background: "var(--acento-suave)", borderColor: "var(--acento-suave)", color: "var(--acento)" }
              : { background: "#ffffff", borderColor: "var(--borde)", color: "var(--acento)" }
          }
        >
          {enCarrito ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />}
          {enCarrito ? "Agregado" : "Agregar"}
        </button>
      </div>
    </div>
  );
}

/** Lista de recomendaciones ya ordenadas por relevancia: la primera se
 * renderiza como hero, el resto en grilla compacta. */
export function ListaRecomendaciones({
  recomendaciones,
  idsEnCarrito,
  onAgregar,
}: {
  recomendaciones: { paquete: HappiaPackage; razon: string }[];
  idsEnCarrito: Set<string>;
  onAgregar: (paquete: HappiaPackage) => void;
}) {
  if (recomendaciones.length === 0) return null;
  const [principal, ...resto] = recomendaciones;

  return (
    <div className="flex flex-col gap-5">
      <PaqueteHero
        paquete={principal.paquete}
        razon={principal.razon}
        enCarrito={idsEnCarrito.has(principal.paquete.id)}
        onAgregar={onAgregar}
      />
      {resto.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {resto.map(({ paquete, razon }, i) => (
            <PaqueteCompacta
              key={paquete.id}
              paquete={paquete}
              razon={razon}
              enCarrito={idsEnCarrito.has(paquete.id)}
              onAgregar={onAgregar}
              retraso={0.08 * (i + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
