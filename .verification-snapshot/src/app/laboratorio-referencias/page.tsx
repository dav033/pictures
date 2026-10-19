import Link from "next/link";

export default function LaboratorioReferenciasPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 text-texto">
      <h1 className="text-xl font-semibold">Laboratorio de referencias JSON</h1>
      <p className="text-sm text-texto-suave">
        Este laboratorio ya no genera imágenes. La creación de imágenes de la aplicación usa FLUX base.
      </p>
      <Link href="/" className="ui-button-primary w-fit rounded-lg px-4 py-2">
        Volver al chat
      </Link>
    </main>
  );
}
