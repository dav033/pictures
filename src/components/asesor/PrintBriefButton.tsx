"use client";

export function PrintBriefButton() {
  return <button className="brief-print-link" type="button" onClick={() => window.print()}>Imprimir / PDF</button>;
}
