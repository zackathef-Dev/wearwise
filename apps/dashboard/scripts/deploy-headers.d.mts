export const PLACEHOLDER_BACKEND: string;
export function pageHeaders(backendUrl: string): Record<string, string>;
export function headersFile(backendUrl: string): string;
export function vercelConfig(backendUrl: string): {
  $schema: string; buildCommand: string; outputDirectory: string;
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
export function deployBackend(env: Record<string, string | undefined>): string;
