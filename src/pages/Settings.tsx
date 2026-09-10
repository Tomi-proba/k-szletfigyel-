import { useState } from 'react'
import { useStore } from '../store/useStore'
import { DEFAULT_SETTINGS } from '../types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Card, Field, Input, PageHeader } from '../components/ui'

export function Settings() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetToDemoData = useStore((s) => s.resetToDemoData)
  const clearAllData = useStore((s) => s.clearAllData)

  const [form, setForm] = useState(settings)
  const [reminderDaysInput, setReminderDaysInput] = useState(settings.paymentReminderDaysBefore.join(', '))
  const [saved, setSaved] = useState(false)
  const [confirmDemo, setConfirmDemo] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const { costingMethod: _costingMethod, paymentReminderDaysBefore: _paymentReminderDaysBefore, ...numericFields } = form
    if (Object.values(numericFields).some((v) => !Number.isFinite(v) || v < 0)) {
      setError('Egyik érték sem lehet negatív.')
      return
    }
    if (form.avgConsumptionWindowDays === 0 || form.reorderTargetDays === 0 || form.slowMovingWindowDays === 0) {
      setError('Az időszakok hossza nem lehet nulla nap.')
      return
    }
    const reminderDays = reminderDaysInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
    if (reminderDays.length === 0 || reminderDays.some((n) => !Number.isInteger(n) || n <= 0)) {
      setError('A fizetési emlékeztetők napjait pozitív egész számokkal add meg, vesszővel elválasztva (pl. 7, 3, 1).')
      return
    }
    const paymentReminderDaysBefore = Array.from(new Set(reminderDays)).sort((a, b) => b - a)
    updateSettings({ ...form, paymentReminderDaysBefore })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function num(key: keyof typeof form) {
    return {
      value: String(form[key]),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: Number(e.target.value) })),
    }
  }

  return (
    <div>
      <PageHeader title="Beállítások" subtitle="Riasztási küszöbértékek testreszabása" />

      <form onSubmit={handleSubmit} className="max-w-xl">
        <Card className="mb-5">
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">Beszerzési költség számítása</h2>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            Ez határozza meg, hogy a termék beszerzési ára és az eladások önköltsége (haszonkulcs kimutatás) hogyan számolódik, amikor
            ugyanabból a termékből több tételt is eltérő áron vettél.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, costingMethod: 'average' }))}
              className={`rounded-lg border p-3 text-left transition-colors ${
                form.costingMethod === 'average'
                  ? 'border-[var(--color-primary)] bg-[var(--color-info-bg)]'
                  : 'border-[var(--color-border)]'
              }`}
            >
              <div className="text-sm font-semibold text-[var(--color-text)]">Súlyozott átlagár</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Minden beszerzés egy közös átlagköltségbe olvad bele - egyszerűbb, kevésbé pontos áringadozásnál.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, costingMethod: 'fifo' }))}
              className={`rounded-lg border p-3 text-left transition-colors ${
                form.costingMethod === 'fifo' ? 'border-[var(--color-primary)] bg-[var(--color-info-bg)]' : 'border-[var(--color-border)]'
              }`}
            >
              <div className="text-sm font-semibold text-[var(--color-text)]">FIFO (első be, első ki)</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Minden tétel a saját árán könyvelődik el, a legrégebbi tétel fogy el elsőként - pontosabb, ha sokat ingadozik a beszerzési
                ár.
              </div>
            </button>
          </div>
        </Card>

        <Card className="mb-5">
          <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Fogyás- és rendelésszámítás</h2>

          <Field label="Átlagos napi fogyás számítási időszaka (nap)">
            <Input type="number" min={1} {...num('avgConsumptionWindowDays')} />
          </Field>
          <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
            Ennyi nap kimenő mozgásaiból számoljuk az átlagos napi fogyást (alapértelmezetten 30 nap).
          </p>

          <Field label="Biztonsági tartalék (nap)">
            <Input type="number" min={0} {...num('safetyStockDays')} />
          </Field>
          <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
            A beszállító szállítási idejéhez adott extra puffer, mielőtt a rendszer rendelést javasol.
          </p>

          <Field label="Rendelési célidőszak (nap)">
            <Input type="number" min={1} {...num('reorderTargetDays')} />
          </Field>
          <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
            A javasolt rendelési mennyiség ennyi napra elegendő készletet céloz meg.
          </p>
        </Card>

        <Card className="mb-5">
          <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Lassan fogyó termékek</h2>

          <Field label="Vizsgált időszak (nap)">
            <Input type="number" min={1} {...num('slowMovingWindowDays')} />
          </Field>
          <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
            Az utolsó ennyi nap fogyását hasonlítjuk az azt megelőző ugyanennyi naphoz (alapértelmezetten 60 nap).
          </p>

          <Field label="Visszaesés küszöbe (%)">
            <Input type="number" min={1} max={100} {...num('slowMovingThresholdPercent')} />
          </Field>
          <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
            Ha a fogyás ennyi %-kal esik vissza az előző időszakhoz képest, a termék "lassan fogyó" jelzést kap.
          </p>
        </Card>

        <Card className="mb-5">
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">Fizetési határidő emlékeztetők</h2>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            A kimenő fizetési kötelezettségek (beszállítói számlák, bérleti díj, egyéb kiadások) ennyi nappal a határidő előtt jelennek
            meg "közelgő" riasztásként. A lejárt, ki nem fizetett tételek mindig megjelennek, függetlenül ettől.
          </p>
          <Field label="Emlékeztető napok (vesszővel elválasztva, pl. 7, 3, 1)">
            <Input value={reminderDaysInput} onChange={(e) => setReminderDaysInput(e.target.value)} placeholder="7, 3, 1" />
          </Field>
        </Card>

        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit">Beállítások mentése</Button>
          {saved && <span className="text-sm text-[var(--color-success)]">Elmentve.</span>}
        </div>
      </form>

      <Card className="mt-8 max-w-xl border-[var(--color-danger)]/30">
        <h2 className="mb-1 text-base font-semibold text-[var(--color-text)]">Veszélyzóna</h2>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">Ezek a műveletek nem visszavonhatók.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConfirmDemo(true)}>
            Demó adatok visszaállítása
          </Button>
          <Button variant="danger" onClick={() => setConfirmClear(true)}>
            Összes adat törlése
          </Button>
        </div>
      </Card>

      {confirmDemo && (
        <ConfirmDialog
          title="Demó adatok visszaállítása"
          message="Ez felülírja az összes jelenlegi terméket, beszállítót, telephelyet és mozgást a beépített minta adatokkal. Biztosan folytatod?"
          confirmLabel="Visszaállítás"
          danger
          onConfirm={() => {
            resetToDemoData()
            setForm(DEFAULT_SETTINGS)
            setReminderDaysInput(DEFAULT_SETTINGS.paymentReminderDaysBefore.join(', '))
            setConfirmDemo(false)
          }}
          onCancel={() => setConfirmDemo(false)}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Összes adat törlése"
          message="Ez véglegesen törli az összes terméket, beszállítót, mozgást és extra telephelyet. Biztosan folytatod?"
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            clearAllData()
            setForm(DEFAULT_SETTINGS)
            setReminderDaysInput(DEFAULT_SETTINGS.paymentReminderDaysBefore.join(', '))
            setConfirmClear(false)
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}
