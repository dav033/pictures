const PUBLIC_PAGE_PATH = /^\/cotizacion-compartida\/[^/]+\/?$/;
const PUBLIC_API_PATH = /^\/api\/cotizacion-compartida\/[^/]+(?:\/(?:imagen|decision))?\/?$/;

export function isPublicSharedQuotePath(pathname: string): boolean {
  return PUBLIC_PAGE_PATH.test(pathname) || PUBLIC_API_PATH.test(pathname);
}
