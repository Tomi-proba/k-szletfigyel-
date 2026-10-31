// A friss projekthez futtatandó supabase/schema.sql és a meglévő projekthez futtatandó migráció
// nem térhet el egymástól.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const olvas = (ut: string) => readFileSync(new URL(`../../${ut}`, import.meta.url), 'utf8')

describe('séma', () => {
  it('a schema.sql szó szerint tartalmazza a 2026-10-23-i migrációt', () => {
    expect(olvas('supabase/schema.sql')).toContain(olvas('supabase/migrations/2026-10-23_szerveroldali_adatok.sql'))
  })

  it('a schema.sql szó szerint tartalmazza a 2026-10-29-i (integrációs) migrációt', () => {
    expect(olvas('supabase/schema.sql')).toContain(olvas('supabase/migrations/2026-10-29_integracio.sql'))
  })

  it('a schema.sql szó szerint tartalmazza a 2026-10-31-i (Könyvelőből érkező tételek) migrációt', () => {
    expect(olvas('supabase/schema.sql')).toContain(olvas('supabase/migrations/2026-10-31_integracio_bejovo.sql'))
  })

  it('a schema.sql szó szerint tartalmazza a 2026-10-31-i (számladátumok) migrációt', () => {
    expect(olvas('supabase/schema.sql')).toContain(olvas('supabase/migrations/2026-10-31_szamla_datumok.sql'))
  })

  it('a schema.sql szó szerint tartalmazza a 2026-10-31-i (egyeztetés) migrációt', () => {
    expect(olvas('supabase/schema.sql')).toContain(olvas('supabase/migrations/2026-10-31_egyeztetes.sql'))
  })
})
