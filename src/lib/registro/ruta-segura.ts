const PUBLIC_QUOTE_PAGE_TOKEN = /^(\/cotizacion-compartida\/)[^/]+(?=\/|$)/;
const PUBLIC_QUOTE_API_TOKEN = /^(\/api\/cotizacion-compartida\/)[^/]+(?=\/|$)/;

export function redactRouteForLogs(pathname: string): string {
  return pathname
    .replace(PUBLIC_QUOTE_PAGE_TOKEN, "$1[token]")
    .replace(PUBLIC_QUOTE_API_TOKEN, "$1[token]");
}
