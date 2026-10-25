import type { BriefViewData } from "@/lib/asesor/brief";
import { getBriefChangeLines, getBriefDisplayEntries } from "@/lib/asesor/brief-display";
import Image from "next/image";
import { PrintBriefButton } from "./PrintBriefButton";

export function BriefView({ data, conversationId }: { data: BriefViewData; conversationId: string }) {
  const entries = getBriefDisplayEntries(data);
  const changes = getBriefChangeLines(data);
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
      {changes.length > 0 && <section className="brief-details" aria-label="Historial de cambios"><div className="brief-detail"><h2>Historial de cambios</h2><ol>{changes.map((line, index) => <li key={index}>{line}</li>)}</ol></div></section>}
      {data.photos.length > 0 && <section className="brief-photos"><h2>Fotos de referencia</h2><div className="brief-photo-grid">
        {data.photos.map((photo) => <figure key={photo.id}><Image src={photo.thumbnailUrl} alt={photo.kind === "venue" ? "Foto del lugar del evento" : "Foto de inspiración"} width={240} height={160} unoptimized /><figcaption>{photo.kind === "venue" ? "Lugar" : "Inspiración"} · confirmación {photo.confirmed === null ? "pendiente" : photo.confirmed ? "sí" : "no"} · preferencia {photo.preference} · {photo.id.slice(0, 8)}</figcaption></figure>)}
      </div></section>}
      {data.projection === "full" && data.approval && <p className="brief-approved">Aprobado por el cliente</p>}
    </main>
  );
}
