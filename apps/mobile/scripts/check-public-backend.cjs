const fs = require('node:fs');
const path = require('node:path');
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname, '../.env.production'), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, '')];
}));
(async () => {
  const results = [];
  for (const table of ['profiles', 'recorded_sessions', 'recorded_channels']) {
    const response = await fetch(`${env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
      headers: { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    results.push({ table, status: response.status, exposedRows: Array.isArray(body) ? body.length : null });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => r.exposedRows > 0)) process.exitCode = 1;
})().catch((error) => { console.error(`Read-only public backend check failed (${error.cause?.code || error.name}); no response data or credentials printed.`); process.exitCode = 1; });
