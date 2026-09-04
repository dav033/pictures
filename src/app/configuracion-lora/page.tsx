import { connection } from "next/server";
import Link from "next/link";
import Image from "next/image";
import LoraRegistryPanel from "@/components/lora/LoraRegistryPanel";
import LoraStructureConsole from "@/components/lora/LoraStructureConsole";
import SnapshotSyncPanel from "@/components/lora/SnapshotSyncPanel";
import { leerComposicionLocal, type Elemento, type ElementoShopify } from "@/lib/lora/composicion";
import { readLocalSnapshot } from "@/lib/lora/snapshot";

// `cacheComponents` (next.config.ts) no detecta lecturas de fs como dinámicas,
// así que sin connection() esta página se prerenderiza estática en el build y
// queda congelada con el snapshot de ese momento — nunca reflejaría un
// snapshot publicado después. Mismo patrón que src/app/admin/page.tsx.
export const instant = false;

/** Barra proporcional: el porcentaje es sobre las 154 fotos, no sobre el grupo. */
function Barra({ elemento, interactiva = false }: { elemento: Elemento; interactiva?: boolean }) {
  const resumen = (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-texto">{elemento.nombre}</span>
          <span className="shrink-0 text-xs tabular-nums text-texto-suave">
            {elemento.captions} · {elemento.pct}%
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-superficie-2">
          <div className="h-full rounded-full bg-acento" style={{ width: `${Math.max(elemento.pct, 1)}%` }} />
        </div>
      </div>
    </div>
  );

  if (!interactiva) return resumen;

  const imagenes = elemento.imagenes ?? [];
  return (
    <details className="group rounded-2xl px-2 transition hover:bg-superficie-2">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg leading-none text-acento transition group-open:rotate-90">›</span>
          <div className="min-w-0 flex-1">{resumen}</div>
        </div>
      </summary>
      <div className="border-t border-borde pb-3 pl-7 pt-3">
        {imagenes.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-texto-suave">
              {imagenes.length} {imagenes.length === 1 ? "foto asociada" : "fotos asociadas"}. Haz click en una para verla completa.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {imagenes.map((archivo) => (
                <a
                  key={archivo}
                  href={`/api/lora/dataset/${encodeURIComponent(archivo)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-xl border border-borde bg-superficie-2 transition hover:border-acento hover:opacity-90"
                >
                  <Image
                    width={300}
                    height={300}
                    src={`/api/lora/dataset/${encodeURIComponent(archivo)}`}
                    alt={`${elemento.nombre} · ${archivo.replace(/\.[^.]+$/, "")}`}
                    loading="lazy"
                    unoptimized
                    className="aspect-square w-full object-cover"
                  />
                </a>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-texto-suave">No hay miniaturas disponibles en este entorno.</p>
        )}
      </div>
    </details>
  );
}

function FilaShopify({ elemento }: { elemento: ElementoShopify }) {
  return (
    <li className="rounded-2xl bg-superficie-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-texto">{elemento.producto}</p>
          <p className="mt-1 text-xs text-texto-suave">
            {elemento.variante ?? "Sin variante"} · SKU {elemento.sku ?? "sin SKU"}
          </p>
        </div>
        <span className="shrink-0 text-right text-xs tabular-nums text-texto-suave">
          {elemento.fotos} fotos · {elemento.pct}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fondo">
        <div className="h-full rounded-full bg-acento-2" style={{ width: `${Math.max(elemento.pct, 1)}%` }} />
      </div>
    </li>
  );
}

export default async function ConfiguracionLoraPage() {
  await connection();
  const datos = leerComposicionLocal() ?? readLocalSnapshot()?.composicion ?? null;

  const parametros: Array<[string, string]> = datos
    ? [
        ["Modelo base", "FLUX.2 [dev]"],
        ["Trigger", datos.lora.trigger],
        ["Pasos de entrenamiento", `${datos.lora.steps} · ${datos.lora.epocas} épocas`],
        ["Learning rate", String(datos.lora.learning_rate)],
        ["Rank", String(datos.lora.rank)],
        ["Escala en producción", "0.8"],
        ["Guidance · pasos", "3.5 · 28"],
        ["Costo del entrenamiento", `US$${datos.lora.costo_usd.toFixed(2)}`],
      ]
    : [];

  return (
    <main className="min-h-[100dvh] bg-fondo px-5 py-8 text-texto sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6" style={{ animation: "workspace-in 520ms var(--ease-out) both" }}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-acento">Sempertex · laboratorio</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Configuración LoRA</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-texto-suave">
              Estado del estilo visual entrenado y de qué está compuesto su dataset.
            </p>
          </div>
          <span className="rounded-full bg-exito-suave px-3 py-1.5 text-xs font-semibold text-exito">
            {datos ? `${datos.lora.etiqueta} en producción` : "sin datos"}
          </span>
        </header>

        <LoraRegistryPanel />

        <SnapshotSyncPanel />

        <LoraStructureConsole />

        {!datos ? (
          <section className="rounded-3xl border border-aviso bg-aviso-suave p-5 text-sm leading-6">
            Todavía no hay análisis de composición. Generalo con{" "}
            <code className="rounded bg-superficie-2 px-1.5 py-0.5 text-xs">npx tsx scripts/analizar-composicion-lora.ts</code>.
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
              <div className="grid gap-3 sm:grid-cols-2">
                {parametros.map(([nombre, valor]) => (
                  <div key={nombre} className="rounded-2xl bg-superficie-2 px-4 py-3">
                    <p className="text-xs text-texto-suave">{nombre}</p>
                    <p className="mt-1 text-sm font-medium text-texto">{valor}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-acento/20 bg-acento-suave px-4 py-3 text-sm leading-6">
                Evaluado sobre la escena XV multi-estructura con 6 semillas y criterio fijado de antemano
                (arco 3D que cierra, dos columnas separadas y mesa en cuadro):{" "}
                <strong>6/6 a escala 0,8 y 6/6 a 1,0</strong>. El entrenamiento anterior daba 1/6 a 0,8, y el
                modelo base sin LoRA da 6/6.
              </div>
            </section>

            <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
              <h2 className="text-sm font-semibold">Composición del entrenamiento</h2>
              <p className="mt-1 text-sm leading-6 text-texto-suave">
                {datos.dataset.imagenes} fotos con su descripción. Cada barra es en cuántas de esas fotos
                aparece el elemento, no cuántas veces se nombra. Las descripciones van de{" "}
                {datos.dataset.palabras_min} a {datos.dataset.palabras_max} palabras, mediana{" "}
                {datos.dataset.palabras_mediana}.
              </p>

              <div className="mt-5 space-y-6">
                {datos.composicion.map((g) => (
                  <div key={g.grupo}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-texto-suave">{g.grupo}</h3>
                    {g.elementos.map((e) => (
                      <Barra key={e.nombre} elemento={e} interactiva={g.grupo === "Estructuras"} />
                    ))}
                  </div>
                ))}

                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Elementos Shopify específicos</h3>
                    <span className="text-xs text-texto-suave">
                      {datos.shopify.elementos_representados} productos/variantes representados
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-texto-suave">
                    Productos y variantes exactos de Shopify confirmados como visibles en las fotos. Ordenados por mayor representación; se muestran todos los elementos consolidados.
                  </p>
                  <ul className="mt-3 grid list-none gap-2 p-0 lg:grid-cols-2">
                    {datos.shopify.elementos.map((e) => (
                      <FilaShopify key={`${e.sku ?? e.producto}-${e.variante ?? ""}`} elemento={e} />
                    ))}
                  </ul>
                </div>

                {datos.encuadre.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-texto-suave">
                      Encuadre de las fotos
                    </h3>
                    {datos.encuadre.map((e) => (
                      <Barra key={e.nombre} elemento={e} />
                    ))}
                    <p className="mt-2 text-xs leading-5 text-texto-suave">
                      La app genera 3:2 horizontal. El dataset es casi todo cuadrado o vertical, así que ese
                      formato está fuera de su distribución.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-aviso bg-aviso-suave px-4 py-3 text-sm leading-6">
                <strong>Lo que el dataset no tiene.</strong> Solo el{" "}
                {datos.composicion.find((g) => g.grupo === "Relaciones espaciales")?.elementos.find((e) => e.nombre.includes("bilateral"))?.pct ?? 7}
                % de las fotos muestra una composición bilateral: una pieza central con otra igual a cada
                lado, y el centro de mesa aparece en el{" "}
                {datos.composicion.find((g) => g.grupo === "Estructuras")?.elementos.find((e) => e.nombre === "Centro de mesa")?.pct ?? 4}%.
                Son las dos composiciones que más se piden y las peor representadas: ninguna reescritura de
                descripciones lo arregla, hace falta fotografiar esas escenas.
              </div>
            </section>
          </>
        )}

        <div className="flex flex-wrap gap-3">
          <Link href="/" className="rounded-xl bg-acento px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90">
            Volver al asistente
          </Link>
          {datos?.lora.url && (
            <a
              href={`https://fal.ai/models/fal-ai/flux-2/lora?lora=${encodeURIComponent(datos.lora.url)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-borde px-4 py-2.5 text-sm font-medium text-acento transition hover:border-acento hover:bg-acento-suave"
            >
              Abrir prueba en fal.ai
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
