// Átállás a kötelező kétlépcsős azonosításra és a raktáros tétlenségi ideje (AWEBOLDAL TERV.md F21).
// Mindkettő a 2026-11-05-i migráció függvényeire épül; amíg az nem futott, a részek nem jelennek meg.
import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Card, Select } from './ui'

type Tag = { id: string; name: string | null; email: string; role: string; ketlepcsos: boolean }

/** Csapat oldal: ki állította már be a kétlépcsős azonosítást (a fő iroda és a tulajdonos látja). */
export function KetlepcsosAtallasLista() {
  const { effectiveRole } = useAuth()
  const [tagok, setTagok] = useState<Tag[] | null>(null)
  const latja = effectiveRole === 'fo_iroda' || effectiveRole === 'tulajdonos'

  useEffect(() => {
    if (!supabase || !latja) return
    void supabase.rpc('ketlepcsos_allapot').then(({ data, error }) => setTagok(error ? null : ((data as Tag[] | null) ?? [])))
  }, [latja])

  if (!latja || !tagok) return null
  const hianyzik = tagok.filter((t) => !t.ketlepcsos)
  return (
    <Card className="mt-5" data-atallasi-lista>
      <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Kétlépcsős azonosítás – átállás</h2>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        {hianyzik.length === 0
          ? 'Mindenki beállította a kétlépcsős azonosítást.'
          : `${hianyzik.length} felhasználó még nem állította be. A következő belépéskor a program kéri és végigvezeti a beállításon.`}
      </p>
      <ul className="divide-y divide-[var(--color-border)] text-sm">
        {tagok.map((t) => (
          <li key={t.id} className="flex justify-between gap-3 py-2">
            <span>{t.name ?? t.email}</span>
            <span className={t.ketlepcsos ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>{t.ketlepcsos ? 'beállítva' : 'még nincs'}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const LEHETOSEGEK = [30, 60, 120, 240, 480, 720]
const felirat = (p: number) => (p < 60 ? `${p} perc` : `${p / 60} óra`)

/** Beállítások oldal (fő iroda): a raktáros tétlenségi ideje, 30 perc és 12 óra között. */
export function RaktarosTetlensegBeallitas() {
  const { effectiveRole, company, refreshCompany } = useAuth()
  const [uzenet, setUzenet] = useState<string | null>(null)
  if (effectiveRole !== 'fo_iroda' || !company || company.raktarosTetlensegPerc === null || !supabase) return null
  return (
    <Card className="mb-5">
      <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">Raktáros tétlenségi ideje</h2>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        Ennyi tétlenség után a raktáros munkamenete lejár (alapból 30 perc). A raktáros telefonról, munka közben dolgozik, ezért hosszabbra is
        állíthatja, legfeljebb 12 órára. A kétlépcsős azonosítás ettől függetlenül mindig kötelező.
      </p>
      <Select
        aria-label="Raktáros tétlenségi ideje"
        value={company.raktarosTetlensegPerc}
        onChange={async (e) => {
          const { error } = await supabase!.rpc('raktaros_tetlenseg_beallitasa', { perc: Number(e.target.value) })
          setUzenet(error ? error.message : 'Elmentve.')
          if (!error) await refreshCompany()
        }}
      >
        {LEHETOSEGEK.map((p) => (
          <option key={p} value={p}>
            {felirat(p)}
          </option>
        ))}
      </Select>
      {uzenet && <p className="mt-2 text-sm">{uzenet}</p>}
    </Card>
  )
}
