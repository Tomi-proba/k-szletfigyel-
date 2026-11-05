// A kiválasztott cég (AWEBOLDAL TERV.md F24 KS4): minden Supabase-kérés az x-keszlet-ceg fejlécben viszi; az
// adatbázis csak ennek a cégnek az adatait engedi (lásd tests/db/tobbceg.test.ts).
import { describe, expect, it } from 'vitest'
import { cegesFetch, kivalasztottCegBeallitas } from '../src/lib/supabase'

describe('a kiválasztott cég fejléce', () => {
  it('a kiválasztott cég minden kéréshez hozzákerül, a meglévő fejlécek mellé; cégváltáskor az új', async () => {
    const kapott: Headers[] = []
    const f = cegesFetch(async (_input, init) => {
      kapott.push(new Headers(init?.headers))
      return new Response('{}')
    })
    kivalasztottCegBeallitas(null)
    await f('https://x.supabase.co/rest/v1/products', { headers: { apikey: 'k' } })
    expect(kapott[0]!.get('x-keszlet-ceg')).toBeNull()
    kivalasztottCegBeallitas('11111111-1111-4111-8111-111111111111')
    await f('https://x.supabase.co/rest/v1/products', { headers: { apikey: 'k' } })
    expect(kapott[1]!.get('x-keszlet-ceg')).toBe('11111111-1111-4111-8111-111111111111')
    expect(kapott[1]!.get('apikey')).toBe('k')
    kivalasztottCegBeallitas('22222222-2222-4222-8222-222222222222')
    await f('https://x.supabase.co/rest/v1/products')
    expect(kapott[2]!.get('x-keszlet-ceg')).toBe('22222222-2222-4222-8222-222222222222')
    kivalasztottCegBeallitas(null)
  })
})
