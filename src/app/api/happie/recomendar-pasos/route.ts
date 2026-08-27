import {
  HappiaClient,
  cargarConfigDesdeEnv,
  paquetesParaTipoCurado,
  ordenarPorInvitados,
  recomendarPaquetesEstructurado,
} from "@sempertex/happie-package-ia";

type Body = {
  tipoEvento?: string;
  invitados?: number;
  ubicacion?: string;
  necesidades?: string[];
};

export async function POST(request: Request) {
  const { tipoEvento, invitados, ubicacion, necesidades }: Body = await request.json();

  if (!tipoEvento || !ubicacion || !invitados || invitados <= 0) {
    return Response.json({ error: "Falta tipo de evento, cantidad de invitados o ubicación." }, { status: 400 });
  }

  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages();

    // Narrowing determinista (sin LLM): primero por el tipo curado elegido
    // (con fallback a todo el catálogo activo si no hay categoría exacta —
    // así el LLM sí llega a evaluar si algo encaja por temática), luego por
    // cercanía a los invitados pedidos.
    const { paquetes: coincidencias, coincidenciaExacta } = paquetesParaTipoCurado(tipoEvento, packages);
    const candidatos = ordenarPorInvitados(coincidencias, invitados);
    const resultado = await recomendarPaquetesEstructurado({
      tipoEvento,
      invitados,
      ubicacion,
      paquetes: candidatos,
      coincidenciaExacta,
      necesidades,
    });

    return Response.json(resultado);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: `No se pudo generar la recomendación: ${detalle}` }, { status: 502 });
  }
}
