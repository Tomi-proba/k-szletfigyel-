// Beállítások → Kapcsolat a többi programmal (TERV.md F15.2, D13). Az iroda látja az állapotot (össze van-e
// kapcsolva, hány esemény vár és mióta, mi nem küldhető el); a fő iroda kapcsolódási kódot készít, és egy
// elakadt változást indoklással kihagyhat. Helyi módban (bejelentkezés nélkül) nem kapcsolható össze.
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { integracioAllapot, kapcsolodasiKodKeszitese, valtozasKihagyasa, type IntegracioAllapot, type IntegracioTeendo } from '../lib/integracio'
import { formatDateTime } from '../lib/format'

export function IntegracioBeallitas({ foIroda }: { foIroda: boolean }) {
  const remote = useStore((s) => s.dataMode === 'remote')
  const [allapot, setAllapot] = useState<IntegracioAllapot | null>(null)
  const [hiba, setHiba] = useState<string | null>(null)
  const [adoszam, setAdoszam] = useState('')
  const [kod, setKod] = useState<{ kod: string; lejar: string } | null>(null)
  const [kodHiba, setKodHiba] = useState<string | null>(null)
  const [masolva, setMasolva] = useState(false)

  const betolt = useCallback(async () => {
    try {
      setAllapot(await integracioAllapot())
      setHiba(null)
    } catch (e) {
      setHiba((e as Error).message)
    }
  }, [])
  useEffect(() => {
    if (!remote) return
    void betolt()
    const t = setInterval(() => void betolt(), 60_000)
    return () => clearInterval(t)
  }, [remote, betolt])

  if (!remote) {
    return (
      <section className="card kozos mb-5" aria-labelledby="integracio-cim">
        <h2 id="integracio-cim" className="mb-2 text-base font-semibold">
          Kapcsolat a többi programmal (Könyvelő, eÁFA)
        </h2>
        <p className="muted text-sm">Összekapcsolni csak szerveres módban (bejelentkezve) lehet. Helyi módban a Készlet önállóan, teljes értékűen működik.</p>
      </section>
    )
  }

  const kodKeszites = async () => {
    setKodHiba(null)
    setMasolva(false)
    try {
      setKod(await kapcsolodasiKodKeszitese(adoszam))
      void betolt()
    } catch (e) {
      setKodHiba((e as Error).message)
    }
  }

  const varakozik = (allapot?.osszeallitasra_var ?? 0) + (allapot?.atadasra_var ?? 0)

  return (
    <section className="card kozos mb-5 flex flex-col gap-3" aria-labelledby="integracio-cim">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="integracio-cim" className="text-base font-semibold">
          Kapcsolat a többi programmal (Könyvelő, eÁFA)
        </h2>
        {allapot && (allapot.osszekapcsolva ? <span className="badge badge-success">Összekapcsolva</span> : <span className="badge">Nincs összekapcsolva</span>)}
      </div>
      {hiba && <p className="alert alert-warning text-sm">{hiba}</p>}

      {allapot?.osszekapcsolva ? (
        <>
          <p className="text-sm">
            A beszerzések, eladások, visszáruk, leltáreltérések és napi zárások maguktól eljutnak a Könyvelőbe (ott jóváhagyással könyvelik). A Könyvelő
            számláiból jövő áru a „Jóváhagyásra vár” listában jelenik meg.
          </p>
          <p className="text-sm">
            {varakozik === 0 ? (
              <span className="badge badge-success">Minden esemény átadva</span>
            ) : (
              <>
                <span className="badge badge-warning">{varakozik} esemény vár átadásra</span>
                {allapot.legregebbi_varakozo && <span className="muted"> · a legrégebbi: {formatDateTime(allapot.legregebbi_varakozo)}</span>}
              </>
            )}
          </p>
          {allapot.utolso_hiba && <p className="alert alert-warning text-sm">Utolsó hiba az átadásnál: {allapot.utolso_hiba} Az események nem vesztek el; amint lehet, átadjuk őket.</p>}
        </>
      ) : (
        allapot && (
          <p className="text-sm">
            Összekapcsolás után a Készlet tételei maguktól eljutnak a Könyvelőbe, és a Könyvelő számláiból jövő áru itt jelenik meg jóváhagyásra. Összekapcsolás
            nélkül a Készlet pontosan úgy működik, mint eddig.
          </p>
        )
      )}

      {foIroda && (
        <div className="card card-muted flex flex-col gap-2">
          <h3 className="font-semibold">Kapcsolódási kód</h3>
          <p className="muted text-sm">
            Az összekapcsoláshoz egy egyszer használható, 24 óráig érvényes kód kell, amelyet a központ kezelője ír be. Pusztán az adószámmal nem lehet
            összekapcsolni; az adószám csak kiegészítő ellenőrzés.
            {allapot?.ervenyes_kod_lejar && !kod ? ` Van érvényes kód (lejár: ${formatDateTime(allapot.ervenyes_kod_lejar)}); egy új kód az előzőt érvényteleníti.` : ''}
          </p>
          {kod ? (
            <div className="flex flex-col gap-2">
              <p className="alert alert-info">
                <span className="block text-sm">A kód (csak most látszik, jegyezze fel vagy másolja ki):</span>
                <span className="block font-mono text-2xl font-bold tracking-wider" aria-live="polite">
                  {kod.kod}
                </span>
                <span className="muted block text-sm">Lejár: {formatDateTime(kod.lejar)}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void navigator.clipboard?.writeText(kod.kod).then(() => setMasolva(true), () => setMasolva(false))}
                >
                  {masolva ? 'Kimásolva' : 'Kód másolása'}
                </button>
                <button type="button" className="btn" onClick={() => setKod(null)}>
                  Kész
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">A cég adószáma</span>
                <input
                  className="w-48 rounded-lg border border-[var(--szin-keret)] bg-[var(--szin-hatter)] px-3 py-2.5"
                  inputMode="numeric"
                  placeholder="12345678-1-12"
                  value={adoszam}
                  onChange={(e) => setAdoszam(e.target.value)}
                />
              </label>
              <button type="button" className="btn btn-primary" onClick={() => void kodKeszites()}>
                Kapcsolódási kód készítése
              </button>
            </div>
          )}
          {kodHiba && (
            <p className="alert alert-danger text-sm" role="alert">
              {kodHiba}
            </p>
          )}
        </div>
      )}

      {allapot && allapot.teendok.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Teendők</h3>
          <ul className="flex flex-col gap-2">
            {allapot.teendok.map((t) => (
              <TeendoSor key={t.id} t={t} foIroda={foIroda} onKesz={() => void betolt()} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function TeendoSor({ t, foIroda, onKesz }: { t: IntegracioTeendo; foIroda: boolean; onKesz: () => void }) {
  const [nyitva, setNyitva] = useState(false)
  const [indok, setIndok] = useState('')
  const [hiba, setHiba] = useState<string | null>(null)
  const kihagyhato = foIroda && t.fajta === 'OSSZEALLITAS_HIBA' && t.valtozasId !== null
  const kihagy = async () => {
    try {
      await valtozasKihagyasa(t.valtozasId!, indok)
      onKesz()
    } catch (e) {
      setHiba((e as Error).message)
    }
  }
  return (
    <li className="alert alert-warning flex flex-col gap-2">
      <span className="font-medium">{t.cim}</span>
      {t.reszletek && <span className="text-sm whitespace-pre-line">{t.reszletek}</span>}
      <span className="muted text-xs">{formatDateTime(t.letrehozva)}</span>
      {kihagyhato &&
        (nyitva ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Miért hagyja ki? (a naplóba kerül)</span>
              <textarea className="rounded-lg border border-[var(--szin-keret)] bg-[var(--szin-hatter)] px-3 py-2" rows={2} value={indok} onChange={(e) => setIndok(e.target.value)} />
            </label>
            {hiba && <span className="text-sm">{hiba}</span>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-small" onClick={() => setNyitva(false)}>
                Mégse
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={() => void kihagy()}>
                Kihagyom
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-small self-start" onClick={() => setNyitva(true)}>
            Kihagyás indoklással…
          </button>
        ))}
    </li>
  )
}
