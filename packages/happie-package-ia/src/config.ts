export interface HappiaConfig {
  baseUrl: string;
  apiKey: string;
}

export function cargarConfigDesdeEnv(env: NodeJS.ProcessEnv = process.env): HappiaConfig {
  const baseUrl = env.HAPPIA_API_BASE_URL;
  const apiKey = env.HAPPIA_API_KEY;

  if (!baseUrl) {
    throw new Error("Falta la variable de entorno HAPPIA_API_BASE_URL");
  }
  if (!apiKey) {
    throw new Error("Falta la variable de entorno HAPPIA_API_KEY");
  }

  return { baseUrl, apiKey };
}
