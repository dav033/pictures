import Link from "next/link";

const resumen = [
  ["Proveedor", "fal.ai"],
  ["Modelo base", "FLUX.2 [dev]"],
  ["Trigger", "eventdecor_style_v1"],
];

const parametrosTecnicos = [
  ["LoRA", "pytorch_lora_weights.safetensors"],
  ["Prompt de prueba", "Boda elegante con cortina marfil y globos azules y dorados"],
  ["Escala LoRA", "1.0"],
  ["Guidance", "2.5"],
  ["Seed", "42"],
  ["Pasos de inferencia", "28 · pesos nuevos"],
  ["Imágenes", "1"],
];

export default function ConfiguracionLoraPage() {
  return (
    <main className="min-h-screen bg-fondo px-5 py-8 text-texto sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6" style={{ animation: "workspace-in 520ms var(--ease-out) both" }}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-acento">
              Sempertex · laboratorio
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Configuración LoRA</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-texto-suave">
              Parámetros preparados para probar el estilo visual entrenado con imágenes aprobadas de Sempertex.
            </p>
          </div>
          <span className="rounded-full bg-exito-suave px-3 py-1.5 text-xs font-semibold text-exito">
            Entrenamiento completado
          </span>
        </header>

        <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
          <div className="grid gap-3 sm:grid-cols-3">
            {resumen.map(([nombre, valor]) => (
              <div key={nombre} className="rounded-2xl border border-acento/20 bg-acento-suave px-4 py-3">
                <p className="text-xs font-medium text-acento">{nombre}</p>
                <p className="mt-1 text-sm font-semibold text-texto">{valor}</p>
              </div>
            ))}
          </div>

          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-texto-suave">
            Parámetros de inferencia
          </h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {parametrosTecnicos.map(([nombre, valor]) => (
              <div key={nombre} className="rounded-2xl bg-superficie-2 px-4 py-3">
                <p className="text-xs text-texto-suave">{nombre}</p>
                <p className="mt-1 text-sm font-medium text-texto">{valor}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-aviso bg-aviso-suave px-4 py-3 text-sm leading-6 text-texto">
            El entrenamiento terminó correctamente. Esta pantalla no ejecuta la generación ni consume crédito; usa el asistente y selecciona «Comparar Gemini + LoRA» para lanzar una prueba.
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-xl bg-acento px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Volver al asistente
          </Link>
          <a
            href="https://fal.ai/models/fal-ai/flux-2/lora?fromTraining=01a00112-7e07-78e1-bff5-5404a8637bdf"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-borde px-4 py-2.5 text-sm font-medium text-acento transition hover:border-acento hover:bg-acento-suave"
          >
            Abrir prueba en fal.ai
          </a>
        </div>
      </div>
    </main>
  );
}
