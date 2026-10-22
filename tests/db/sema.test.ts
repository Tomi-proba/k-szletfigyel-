// A friss projekthez futtatandó supabase/schema.sql és a meglévő projekthez futtatandó migráció
// nem térhet el egymástól.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const olvas = (ut: string) => readFileSync(new URL(`../../${ut}`, import.meta.url), 'utf8')

describe('séma', () => {
  it('a schema.sql szó szerint tartalmazza a 2026-10-23-i migrációt', () => {
    expect(olvas('supabase/schema.sql')).toContain(olvas('supabase/migrations/2026-10-23_szerveroldali_adatok.sql'))
  })
})
