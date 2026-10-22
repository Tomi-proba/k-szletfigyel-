import { AlertTriangle, CheckCircle2, Download, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  BIZTONSAGI_KULCS,
  CSOPORT_NEV,
  CSOPORT_SORREND,
  HELYI_KULCS,
  atkoltoztetesiTerv,
  feltoltesiKotegek,
  helyiPillanatkep,
  hianyzoRekordok,
  jeloloKulcs,
  type AtkoltoztetesiTerv,
  type Csoport,
  type HelyiAdatok,
} from '../lib/atkoltoztetes'
import { mentesiSor } from '../lib/mentes'
import { allapotUzenet, type SorAllapot } from '../lib/mentesiSor'
import { emptyBusinessSlices, mentesiTetel, valtozasokKiszamitasa, vanSzerverBeallitas } from '../lib/remoteSync'
import { createId } from '../store/id'
import { useStore } from '../store/useStore'
import { Modal } from './Modal'
import { Button, Card } from './ui'

function olvas(kulcs: string): string | null {
  try {
    return localStorage.getItem(kulcs)
  } catch {
    return null
  }
}

/** Megvárja, amíg a mentési sor kiürül (mentve) vagy elakad; az újrapróbálás közben tovább vár. */
function vegeig(): Promise<SorAllapot> {
  return new Promise((resolve) => {
    const le = mentesiSor.figyel((a) => {
      if (a.fajta === 'mentve' || a.fajta === 'elakadt') {
        queueMicrotask(() => le())
        resolve(a)
      }
    })
  })
}

/** Szerveres módban, a fő irodának: ha a böngészőben olyan adat van, ami még nincs a szerveren,
 * felajánlja az átköltöztetést. */
export function AtkoltoztetesAjanlo() {
  const remote = useStore((s) => s.dataMode === 'remote')
  const companyId = useStore((s) => s.remoteCompanyId)
  const role = useStore((s) => s.remoteRole)
  const [nyitva, setNyitva] = useState(false)
  const [elrejtve, setElrejtve] = useState(false)
  const szerverAdat = useStore((s) => s)

  const helyi = useMemo(() => (remote ? helyiPillanatkep(olvas(HELYI_KULCS)) : null), [remote])
  const terv = useMemo(
    () => (helyi && companyId ? atkoltoztetesiTerv(helyi, szerverAdat, vanSzerverBeallitas(companyId)) : null),
    // A tervet csak bejelentkezéskor számoljuk (utána a felhasználó saját műveletei ne változtassák).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [helyi, companyId],
  )

  if (!remote || role !== 'fo_iroda' || !companyId || !helyi || !terv || elrejtve) return null
  if (olvas(jeloloKulcs(companyId))) return null
  if (terv.osszesen === 0 && !terv.beallitasok) return null

  return (
    <>
      <Card className="mb-5 border-[var(--color-primary)]/30">
        <div className="flex flex-wrap items-start gap-3">
          <UploadCloud size={20} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-[var(--color-text)]">Ebben a böngészőben olyan adat van, ami még nincs a szerveren</p>
            <p className="text-[var(--color-text-muted)]">
              {terv.osszesen} rekord (például beszállítók, vevők, pénzügyi napló) eddig csak ezen az eszközön volt tárolva. Átköltöztetve
              minden eszközről elérhető lesz, és nem veszhet el a böngésző adataival.
            </p>
          </div>
          <Button onClick={() => setNyitva(true)}>Megnézem</Button>
        </div>
      </Card>
      {nyitva && (
        <AtkoltoztetesAblak
          companyId={companyId}
          helyi={helyi}
          terv={terv}
          onClose={() => setNyitva(false)}
          onKesz={() => {
            setNyitva(false)
            setElrejtve(true)
          }}
        />
      )}
    </>
  )
}

type Lepes = { fajta: 'elonezet' } | { fajta: 'folyamatban'; uzenet: string } | { fajta: 'kesz'; darab: number } | { fajta: 'hiba'; uzenet: string }

function AtkoltoztetesAblak({
  companyId,
  helyi,
  terv,
  onClose,
  onKesz,
}: {
  companyId: string
  helyi: HelyiAdatok
  terv: AtkoltoztetesiTerv
  onClose: () => void
  onKesz: () => void
}) {
  const { reloadData } = useAuth()
  const csoportok = CSOPORT_SORREND.filter((c) => terv.feltoltheto[c]?.length)
  // Bemutató adatnál alapból semmi nincs kiválasztva: a felhasználónak kifejezetten kell kérnie.
  const [kivalasztott, setKivalasztott] = useState<Set<Csoport>>(() => new Set(terv.demo ? [] : csoportok))
  const [beallitasokkal, setBeallitasokkal] = useState(!terv.demo && Boolean(terv.beallitasok))
  const [lepes, setLepes] = useState<Lepes>({ fajta: 'elonezet' })

  const biztonsagiLetoltes = () => {
    const nyers = olvas(HELYI_KULCS) ?? '{}'
    const url = URL.createObjectURL(new Blob([nyers], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `keszletfigyelo-biztonsagi-mentes-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const inditas = async () => {
    setLepes({ fajta: 'folyamatban', uzenet: 'Biztonsági másolat készítése…' })
    try {
      localStorage.setItem(BIZTONSAGI_KULCS, olvas(HELYI_KULCS) ?? '')
    } catch {
      // ha a tároló megtelt, a letölthető biztonsági mentés még rendelkezésre áll
    }

    const kotegek = feltoltesiKotegek(helyi, terv, kivalasztott)
    const darab = kotegek.reduce((s, k) => s + Object.values(k).reduce((n, l) => n + (l as unknown[]).length, 0), 0)
    const ures = { ...emptyBusinessSlices }
    kotegek.forEach((koteg, i) => {
      const utolso = i === kotegek.length - 1
      const kovetkezo = {
        ...ures,
        ...koteg,
        auditLog: [
          ...(koteg.auditLog ?? []),
          ...(utolso
            ? [
                {
                  id: createId(),
                  timestamp: new Date().toISOString(),
                  entityType: 'atkoltoztetes' as const,
                  entityId: companyId,
                  entityLabel: 'Átköltöztetés',
                  action: 'create' as const,
                  description: `A böngészőben tárolt adatok átköltöztetése a szerverre (${darab} rekord)`,
                },
              ]
            : []),
        ],
        ...(utolso && beallitasokkal && terv.beallitasok ? terv.beallitasok : {}),
      }
      const valtozasok = valtozasokKiszamitasa(companyId, ures, kovetkezo)
      if (valtozasok.length) mentesiSor.hozzaad(mentesiTetel(companyId, valtozasok))
    })
    if (kotegek.length === 0 && beallitasokkal && terv.beallitasok) {
      const valtozasok = valtozasokKiszamitasa(companyId, ures, { ...ures, ...terv.beallitasok })
      mentesiSor.hozzaad(mentesiTetel(companyId, valtozasok))
    }

    setLepes({ fajta: 'folyamatban', uzenet: `Feltöltés: ${darab} rekord…` })
    const leiratkozas = mentesiSor.figyel((a) => {
      if (a.fajta === 'ujraprobalas') setLepes({ fajta: 'folyamatban', uzenet: allapotUzenet(a) })
    })
    const vege = await vegeig()
    leiratkozas()
    if (vege.fajta === 'elakadt') {
      setLepes({ fajta: 'hiba', uzenet: allapotUzenet(vege) })
      return
    }

    setLepes({ fajta: 'folyamatban', uzenet: 'Ellenőrzés: minden rekord megérkezett-e a szerverre…' })
    await reloadData()
    const hiany = hianyzoRekordok(terv, kivalasztott, useStore.getState())
    const hianyzo = Object.entries(hiany)
    if (hianyzo.length > 0) {
      setLepes({
        fajta: 'hiba',
        uzenet: `Az ellenőrzés szerint nem érkezett meg minden rekord a szerverre (${hianyzo
          .map(([c, n]) => `${CSOPORT_NEV[c as Csoport]}: ${n}`)
          .join(', ')}). A böngészőben lévő adatok érintetlenek; próbáld újra az átköltöztetést.`,
      })
      return
    }
    try {
      localStorage.setItem(jeloloKulcs(companyId), JSON.stringify({ datum: new Date().toISOString(), darab }))
    } catch {
      // nem baj: legközelebb az ellenőrzés úgyis 0 feltöltendő rekordot talál
    }
    setLepes({ fajta: 'kesz', darab })
  }

  const kesobbNe = () => {
    try {
      localStorage.setItem(jeloloKulcs(companyId), JSON.stringify({ datum: new Date().toISOString(), kihagyva: true }))
    } catch {
      // nem baj
    }
    onKesz()
  }

  return (
    <Modal title="Böngészőben tárolt adatok átköltöztetése" onClose={lepes.fajta === 'folyamatban' ? () => {} : onClose} wide>
      {lepes.fajta === 'elonezet' && (
        <div className="space-y-4 text-sm">
          <p>
            Az alábbi adatok eddig csak ebben a böngészőben voltak. Átköltöztetés után a cég minden eszközén elérhetők, és a szerveren
            biztonságban vannak. <strong>A böngészőben lévő adatokat nem töröljük</strong>, és indítás előtt biztonsági másolat is készül.
          </p>
          {terv.demo && (
            <div className="flex gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] p-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
              <span>
                Úgy tűnik, ebben a böngészőben csak a <strong>bemutató (kitalált) adatok</strong> vannak. Ezeket valószínűleg nem szeretnéd a
                céged valódi adatai közé tenni, ezért alapból semmi nincs kiválasztva.
              </span>
            </div>
          )}
          {terv.mod === 'kiegeszito' && Object.keys(terv.kihagyott).length > 0 && (
            <div className="rounded-lg bg-[var(--color-info-bg)] p-3">
              A cégnek már vannak készletadatai a szerveren, ezért a böngészőben lévő készletadatot nem keverjük hozzá automatikusan (
              {Object.entries(terv.kihagyott)
                .map(([c, n]) => `${CSOPORT_NEV[c as Csoport]}: ${n}`)
                .join(', ')}
              ). Ezek a böngészőben és a biztonsági mentésben megmaradnak.
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 font-semibold">Mi kerüljön át?</legend>
            {csoportok.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={kivalasztott.has(c)}
                  onChange={(e) => {
                    const uj = new Set(kivalasztott)
                    if (e.target.checked) uj.add(c)
                    else uj.delete(c)
                    setKivalasztott(uj)
                  }}
                />
                <span>
                  {CSOPORT_NEV[c]}: <strong>{terv.feltoltheto[c]!.length}</strong>
                </span>
              </label>
            ))}
            {terv.beallitasok && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={beallitasokkal} onChange={(e) => setBeallitasokkal(e.target.checked)} />
                <span>Beállítások és napló-kategóriák</span>
              </label>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
            <Button onClick={inditas} disabled={kivalasztott.size === 0 && !beallitasokkal}>
              <UploadCloud size={16} /> Átköltöztetés indítása
            </Button>
            <Button variant="secondary" onClick={biztonsagiLetoltes}>
              <Download size={16} /> Biztonsági mentés letöltése
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Később
            </Button>
            <Button variant="ghost" onClick={kesobbNe}>
              Nem kérem, ne kérdezze újra
            </Button>
          </div>
        </div>
      )}
      {lepes.fajta === 'folyamatban' && (
        <p role="status" className="text-sm">
          {lepes.uzenet}
        </p>
      )}
      {lepes.fajta === 'kesz' && (
        <div className="space-y-4 text-sm">
          <p role="status" className="flex items-center gap-2 font-semibold text-[var(--color-success)]">
            <CheckCircle2 size={18} /> Kész: {lepes.darab} rekord átkerült a szerverre, és az ellenőrzés szerint mind megérkezett.
          </p>
          <p className="text-[var(--color-text-muted)]">A böngészőben lévő eredeti adatokat nem töröltük; a biztonsági másolat is megmaradt.</p>
          <Button onClick={onKesz}>Bezárás</Button>
        </div>
      )}
      {lepes.fajta === 'hiba' && (
        <div className="space-y-4 text-sm">
          <p role="alert" className="text-[var(--color-danger)]">
            {lepes.uzenet}
          </p>
          <Button variant="secondary" onClick={onClose}>
            Bezárás
          </Button>
        </div>
      )}
    </Modal>
  )
}
