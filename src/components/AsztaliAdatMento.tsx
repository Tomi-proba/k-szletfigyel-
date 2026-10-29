// A Windowsos program korábbi indításai alatt tárolt adatok felajánlása visszatöltésre (lásd
// electron/main.js: a régi változat minden indításkor más címről futott, így a korábbi adatokat nem
// látta). Csak az asztali programban jelenik meg.
import { useEffect, useState } from 'react'
import { asztali, type RegiAdat } from '../lib/asztali'
import { ADAT_KULCS, jelenlegiAllapot, visszatoltes, visszatolthetok } from '../lib/regiAdatok'
import { TAROLO_KULCS } from '../lib/mentesiSor'
import { Modal } from './Modal'
import { Button } from './ui'

const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString('hu-HU') : 'ismeretlen időpont')

export function AsztaliAdatMento({ kenyszeritett = false, onClose }: { kenyszeritett?: boolean; onClose?: () => void }) {
  const [regiek, setRegiek] = useState<RegiAdat[] | null>(null)
  const [hiba, setHiba] = useState<string | null>(null)
  const [folyamatban, setFolyamatban] = useState(false)

  useEffect(() => {
    if (!asztali || (!kenyszeritett && asztali.regiAdatokElintezveVan)) return
    asztali
      .regiAdatok()
      .then((r) => {
        const lista = visszatolthetok(r)
        setRegiek(lista)
        // Ha nincs mit visszatölteni, többet nem keresünk magától (a Beállításokban kézzel lehet).
        if (!lista.length && !kenyszeritett) void asztali!.regiAdatokElintezve()
      })
      .catch((e: unknown) => setHiba(e instanceof Error ? e.message : String(e)))
  }, [kenyszeritett])

  if (!asztali || (!regiek && !hiba)) return null
  if (regiek && !regiek.length) {
    if (!kenyszeritett) return null
    return (
      <Modal title="Korábbi adatok keresése" onClose={() => onClose?.()}>
        <p className="text-sm">Nem találtunk korábbi indításból származó adatot.</p>
      </Modal>
    )
  }
  const most = jelenlegiAllapot(localStorage.getItem(ADAT_KULCS), localStorage.getItem(TAROLO_KULCS))
  const bezar = async (vegleges: boolean) => {
    if (vegleges) await asztali!.regiAdatokElintezve()
    setRegiek([])
    onClose?.()
  }

  return (
    <Modal title="Korábbi adatokat találtunk" onClose={() => void bezar(false)} wide>
      <div className="space-y-4 text-sm">
        <p>
          A program korábbi változata minden indításkor más helyről futott, ezért a korábban rögzített adatokat nem látta. Az adatok nem vesztek el: itt
          vannak, és visszatölthetők. Visszatöltés előtt biztonsági mentés készül fájlba, és a régi adatokat nem töröljük.
        </p>
        {hiba && <p className="text-[var(--color-danger)]">A keresés nem sikerült: {hiba}</p>}
        {most.valodiAdat && (
          <p className="rounded-lg bg-[var(--color-warning-bg,#fff6e0)] p-3">
            Figyelem: a mostani indításban is van rögzített adat. A visszatöltés ezt lecseréli (a biztonsági mentésben megmarad).
          </p>
        )}
        <ul className="space-y-3">
          {(regiek ?? []).map((r, i) => (
            <li key={r.cim} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="font-medium">
                {i === 0 ? 'A legutóbbi: ' : ''}utoljára módosítva {datum(r.modositva)}
              </div>
              <div className="text-[var(--color-text-muted)]">
                {r.osszesites
                  ? `${r.osszesites.termekek} termék, ${r.osszesites.mozgasok} mozgás, ${r.osszesites.telephelyek} telephely, ${r.osszesites.naploTetelek} napló-tétel`
                  : 'Csak nem mentett változások'}
                {r.fuggoMentesek > 0 && ` · ${r.fuggoMentesek} még nem mentett művelet`}
              </div>
              <Button
                className="mt-2"
                variant={i === 0 ? 'primary' : 'secondary'}
                disabled={folyamatban}
                onClick={async () => {
                  setFolyamatban(true)
                  try {
                    await visszatoltes(r, localStorage, asztali!.biztonsagiMentes)
                    await asztali!.regiAdatokElintezve()
                    window.location.reload()
                  } catch (e) {
                    setHiba(e instanceof Error ? e.message : String(e))
                    setFolyamatban(false)
                  }
                }}
              >
                Ezt töltsük vissza
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void bezar(false)}>
            Most nem
          </Button>
          <Button variant="ghost" onClick={() => void bezar(true)}>
            Ne kérdezze többet (a Beállításokban később is elérhető)
          </Button>
        </div>
      </div>
    </Modal>
  )
}
