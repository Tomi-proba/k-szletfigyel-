// STUB - nincs bekötve, nincs élesben futtatva.
//
// Ez egy előkészített váz egy jövőbeli, valódi Stripe integrációhoz. A
// Stripe titkos kulcsát (STRIPE_SECRET_KEY) SOHA nem szabad a kliens
// (böngésző) kódba tenni - ezért ennek egy Supabase Edge Function-ként
// (szerver oldalon, Deno runtime-on) kellene futnia, amit a Supabase CLI-vel
// lehet deployolni: `supabase functions deploy create-checkout-session`.
//
// A jelenlegi "Előfizetés" oldal (src/pages/Subscription.tsx) ezt MÉG NEM
// hívja meg - a fizetés ott egyelőre demó módban, ezt a függvényt kihagyva,
// közvetlenül a companies tábla módosításával szimulálja az
// aktiválást/lemondást. Amikor készen álltok az éles Stripe bekötésre:
//
// 1. Hozz létre egy Stripe fiókot, és egy terméket/árat (recurring, HUF).
// 2. Állítsd be a STRIPE_SECRET_KEY és STRIPE_WEBHOOK_SECRET titkokat a
//    Supabase projekt Edge Function secrets között (nem a .env-ben!).
// 3. Töltsd ki lent a checkout session létrehozását, majd hívd meg ezt a
//    függvényt a Subscription.tsx "Előfizetés indítása" gombjából a valódi
//    demó-szimuláció helyett.
// 4. Készíts egy hasonló, külön Edge Function-t a Stripe webhookok
//    fogadására (checkout.session.completed, invoice.payment_failed,
//    customer.subscription.deleted stb.), ami a companies táblát a service
//    role kulccsal (RLS megkerülésével) frissíti - ez teszi a
//    subscription_status/current_period_end mezőket a Stripe-pal
//    valós időben szinkronban tartottá.

// @ts-nocheck - Deno-specifikus import, a projekt fő tsconfig-ja (Node/Vite
// környezetre készült) nem ismeri a "npm:" specifikátort, ezért ez a fájl
// szándékosan ki van zárva a normál típusellenőrzésből, amíg ténylegesen
// deployolásra nem kerül Supabase Edge Function-ként.
import Stripe from 'npm:stripe@17'

Deno.serve(async (req: Request) => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY nincs beállítva - ez a funkció még nincs élesítve.' }), { status: 501 })
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' })
  const { companyId, priceId, successUrl, cancelUrl } = await req.json()

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: companyId,
  })

  return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json' } })
})
