// Edge Function - a Csapat oldal (src/pages/Team.tsx) ezt hívja, amikor az
// iroda egy ÚJ raktáros/iroda felhasználót hoz létre.
//
// MIÉRT KELL EZ (szerver oldali funkció, nem közvetlen böngésző-hívás): egy
// másik ember bejelentkezését (email + jelszó, azonnal megerősített
// állapotban) csak a Supabase "service role" kulcsával lehet létrehozni
// (supabase.auth.admin.createUser) - ez a kulcs a TELJES adatbázist
// megkerüli az RLS-en, ezért SOHA nem szabad a böngészőbe (kliens-oldali
// kódba, .env VITE_ változóba) kerülnie. Ez a függvény Deno runtime-on,
// szerver oldalon fut a Supabase saját infrastruktúráján, ahol a service
// role kulcs biztonságban van (csak a saját, Supabase által adott
// SUPABASE_SERVICE_ROLE_KEY env változóként érhető el, ide senki más nem
// lát bele).
//
// A régi, "küldj linket, a meghívott regisztráljon" folyamat helyett ez
// AZONNAL, regisztrációs lépés nélkül létrehozza az új felhasználó
// bejelentkezését - az iroda egyből megkapja a jelszót, amit átadhat neki
// (pl. szóban, chat-en), a meghívottnak csak be kell jelentkeznie.
//
// Belül újrahasznosítja a MEGLÉVŐ meghívó + handle_new_user() trigger
// mechanizmust (lásd supabase/schema.sql) - csak nem küldünk linket, hanem
// a meghívó tokent rögtön, szerver oldalon átadjuk az admin.createUser()
// hívásnak user_metadata.invite_token-ként, így a trigger pontosan
// ugyanazt a logikát futtatja le (cég/szerepkör/telephely hozzárendelés),
// mint a link-alapú csatlakozásnál - nem kellett duplikálni azt a kódot.
//
// Deployolás (Supabase Dashboard > Edge Functions > Create a new function,
// vagy a Supabase CLI-vel: `supabase functions deploy create-team-member`).
// A SUPABASE_URL, SUPABASE_ANON_KEY és SUPABASE_SERVICE_ROLE_KEY automatikusan
// elérhető minden Edge Function-ben - nincs külön titkot beállítani.

// @ts-nocheck - Deno-specifikus import ("npm:" specifikátor, Deno.serve,
// Deno.env), amit a projekt fő (Node/Vite-ra készült) tsconfig-ja nem ismer
// - ugyanaz a minta, mint a meglévő create-checkout-session stub-ban.
import { createClient } from 'npm:@supabase/supabase-js@2'

const ALL_ROLES = ['raktaros', 'iroda', 'fo_iroda', 'tulajdonos']
// 'iroda' csak raktáros/iroda szintű felhasználót hozhat létre - magasabb
// jogú (fő iroda, tulajdonos) fiók létrehozása kizárólag fő iroda joga.
const IRODA_CREATABLE_ROLES = ['raktaros', 'iroda']

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Csak POST metódus engedélyezett.' }), { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'A funkció nincs megfelelően konfigurálva.' }), { status: 500 })
  }

  const authHeader = req.headers.get('Authorization') ?? ''

  // A hívó saját, NEM admin jogú klienssel azonosítjuk - ez a sima RLS-en
  // megy át, tehát a hívó tényleges jogosultságát ellenőrzi, nem kerülünk
  // meg semmilyen szabályt a KI-HÍVHATJA-EZT kérdésnél, csak magánál a
  // user-létrehozásnál (lentebb, adminClient) kell a service role.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: callerUser },
    error: callerError,
  } = await callerClient.auth.getUser()
  if (callerError || !callerUser) {
    return new Response(JSON.stringify({ error: 'Nincs bejelentkezve.' }), { status: 401 })
  }

  const { data: callerProfile } = await callerClient.from('profiles').select('role, company_id').eq('id', callerUser.id).maybeSingle()
  if (!callerProfile || (callerProfile.role !== 'iroda' && callerProfile.role !== 'fo_iroda')) {
    return new Response(JSON.stringify({ error: 'Csak iroda vagy fő iroda jogosultsággal hozható létre új felhasználó.' }), { status: 403 })
  }

  let body: { email?: string; password?: string; role?: string; assignedLocationId?: string | null; assignedLocationName?: string | null }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Érvénytelen kérés.' }), { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const role = body.role

  if (!email || !password || !role || !ALL_ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: 'Hiányzó vagy érvénytelen mezők.' }), { status: 400 })
  }
  if (callerProfile.role === 'iroda' && !IRODA_CREATABLE_ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: 'Iroda csak raktáros vagy iroda szerepkört hozhat létre - fő iroda/tulajdonos fiókot csak a fő iroda.' }), { status: 403 })
  }
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie.' }), { status: 400 })
  }
  if (role === 'raktaros' && !body.assignedLocationId) {
    return new Response(JSON.stringify({ error: 'Raktáros felhasználóhoz telephely szükséges.' }), { status: 400 })
  }

  // Innentől service role kulccsal - ez az EGYETLEN hely ebben a
  // függvényben, ahol az RLS-t megkerüljük, és csak a már ellenőrzött
  // kérés (iroda-jogosultságú hívó) kiszolgálásához.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: invite, error: inviteError } = await adminClient
    .from('invites')
    .insert({
      company_id: callerProfile.company_id,
      role,
      assigned_location_id: role === 'raktaros' ? body.assignedLocationId : null,
      assigned_location_name: role === 'raktaros' ? (body.assignedLocationName ?? null) : null,
      created_by: callerUser.id,
    })
    .select('token')
    .single()
  if (inviteError || !invite) {
    return new Response(JSON.stringify({ error: 'Nem sikerült előkészíteni a felhasználót.' }), { status: 500 })
  }

  const { error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { invite_token: invite.token },
  })
  if (createError) {
    const message = createError.message?.includes('already been registered')
      ? 'Ezzel az email címmel már van fiók.'
      : (createError.message ?? 'Nem sikerült a felhasználó létrehozása.')
    return new Response(JSON.stringify({ error: message }), { status: 400 })
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})
