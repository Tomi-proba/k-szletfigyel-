// Egyetlen, egységes séma (AWEBOLDAL TERV.md F24 KS4): a friss projekthez futtatandó supabase/schema.sql és az
// egyetlen migráció ugyanaz; régi, lépésenkénti migráció nincs, és a régi (egycéges) szerkezet sem maradt benne.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const olvas = (ut: string) => readFileSync(new URL(`../../${ut}`, import.meta.url), 'utf8')

describe('séma', () => {
  it('egyetlen migráció van, és szó szerint azonos a schema.sql-lel', () => {
    expect(readdirSync(new URL('../../supabase/migrations', import.meta.url))).toEqual(['2026-11-06_tiszta_alap.sql'])
    expect(olvas('supabase/migrations/2026-11-06_tiszta_alap.sql')).toBe(olvas('supabase/schema.sql'))
  })

  it('a cégtagság a company_members táblában van; a profiles-on nincs cég vagy szerepkör', () => {
    const s = olvas('supabase/schema.sql')
    expect(s).toContain('create table if not exists public.company_members')
    expect(s).not.toMatch(/alter table public\.profiles\s+add column/)
    expect(s).not.toMatch(/profiles \(id, company_id/)
  })
})
