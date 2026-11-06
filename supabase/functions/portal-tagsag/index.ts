// Edge Function: portal-tagsag (AWEBOLDAL TERV.md F25 – felhasználókezelés egy helyen). A logika: logika.ts.
//
// Beállítás (Supabase Dashboard > Edge Functions > Secrets, vagy `supabase secrets set`):
//   PORTAL_KIADO     a portál nyilvános címe (a jegyek kiadója), pl. https://portal.<domain>
//   PORTAL_JWKS_URL  elhagyható; alapból <PORTAL_KIADO>/.well-known/jwks.json
// A SUPABASE_URL, SUPABASE_ANON_KEY és SUPABASE_SERVICE_ROLE_KEY a Supabase-ben magától elérhető. A service role
// kulcs csak itt, szerveroldalon él; a böngészőbe soha nem kerül.
// Telepítés: supabase functions deploy portal-tagsag --no-verify-jwt
//   (a portál jelzése szerverről jön, Supabase-token nélkül; a hitelességet a portál aláírása adja).

// @ts-nocheck - Deno-specifikus import ("npm:" specifikátor, Deno.serve, Deno.env)
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0'
import { kezel } from './logika.ts'

const kiado = (Deno.env.get('PORTAL_KIADO') ?? '').replace(/\/+$/, '')
const jwks = createRemoteJWKSet(new URL(Deno.env.get('PORTAL_JWKS_URL') ?? `${kiado}/.well-known/jwks.json`))
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors })
  const torzs = await req.json().catch(() => null)
  const v = await kezel(torzs, req.headers.get('authorization'), {
    ellenoriz: async (token, cimzett) =>
      (await jwtVerify(token, jwks, { issuer: kiado, audience: cimzett, algorithms: ['ES256'], clockTolerance: 30, maxTokenAge: 330 })).payload,
    felhasznaloEmail: async (token) => {
      const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } })
      return r.ok ? ((await r.json()).email ?? null) : null
    },
    igazit: async (portalCeg, email, szerep, jti, lejar) => {
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/portal_tagsag_igazitas`, {
        method: 'POST',
        headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_portal_ceg: portalCeg, p_email: email, p_szerep: szerep, p_jti: jti, p_lejar: lejar.toISOString() }),
      })
      if (!r.ok) throw new Error(`portal_tagsag_igazitas: ${r.status} ${await r.text()}`)
      return await r.json()
    },
  }).catch((e) => ({ statusz: 500, adat: { hiba: 'belso-hiba', uzenet: String(e?.message ?? e) } }))
  return new Response(JSON.stringify(v.adat), { status: v.statusz, headers: { ...cors, 'content-type': 'application/json' } })
})
