import { HappiaClient, cargarConfigDesdeEnv, recomendarPaquetes } from "@sempertex/happie-package-ia";

type Body = {
  descripcionEvento?: string;
};

export async function POST(request: Request) {
  const { descripcionEvento }: Body = await request.json();

  if (!descripcionEvento || !descripcionEvento.trim()) {
    return Response.json({ error: "Describe el evento que vas a realizar." }, { status: 400 });
  }

  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages();

    const resultado = await recomendarPaquetes({ descripcionEvento, paquetes: packages });

    return Response.json(resultado);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: `No se pudo generar la recomendación: ${detalle}` }, { status: 502 });
  }
}
