import type { BriefViewData } from "@/lib/asesor/brief";
import Image from "next/image";
import { PrintBriefButton } from "./PrintBriefButton";

const LABELS: Record<string, string> = {
  eventKind: "Tipo de evento", eventName: "Evento", date: "Fecha", startTime: "Hora de inicio", endTime: "Hora de cierre",
  guestCount: "Invitados", venueType: "Tipo de lugar", venueName: "Lugar", address: "Dirección", city: "Ciudad", department: "Departamento",
  budget: "Presupuesto", contactName: "Contacto", contactPhone: "Teléfono", contactEmail: "Correo",
  honoreeAge: "Edad del homenajeado", companyName: "Empresa", schoolName: "Institución", grade: "Grado", audience: "Público",
  organiserPriority: "Prioridad", theme: "Tema", colors: "Colores", style: "Estilo", likes: "Le gusta", dislikes: "No le gusta",
  brandRequests: "Solicitudes", notes: "Notas", proposedPackage: "Paquete propuesto",
};

function display(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function BriefView({ data, conversationId }: { data: BriefViewData; conversationId: string }) {
  const entries = Object.entries(data.brief)
    .filter(([key]) => key in LABELS)
    .map(([key, value]) => ({ label: LABELS[key], value: display(value) }))
    .filter((entry): entry is { label: string; value: string } => entry.value !== null);
  return (
    <main className="brief-page">
      <header className="brief-header">
        <div><p className="brief-eyebrow">HAPPIA · ASESORÍA DE EVENTOS</p><h1>Resumen del evento</h1></div>
        <div className="brief-actions">
          <a className="brief-print-link" href={`/asesor/brief/${encodeURIComponent(conversationId)}?projection=${data.projection === "full" ? "vendor" : "full"}`}>
            {data.projection === "full" ? "Vista para proveedor" : "Vista completa"}
          </a>
          <PrintBriefButton />
        </div>
      </header>
      <p className="brief-version">Resumen aprobado · versión {data.summary.version}</p>
      <section className="brief-details" aria-label="Datos del evento">
        {entries.map(({ label, value }) => <div className="brief-detail" key={label}><h2>{label}</h2><p>{value}</p></div>)}
      </section>
      {data.photos.length > 0 && <section className="brief-photos"><h2>Fotos de referencia</h2><div className="brief-photo-grid">
        {data.photos.map((photo) => <figure key={photo.id}><Image src={photo.thumbnailUrl} alt="Foto de referencia del evento" width={240} height={160} unoptimized /><figcaption>Referencia {photo.id.slice(0, 8)}</figcaption></figure>)}
      </div></section>}
      {data.projection === "full" && data.approval && <p className="brief-approved">Aprobado por el cliente</p>}
    </main>
  );
}
