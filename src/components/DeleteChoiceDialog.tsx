import { Modal } from './Modal'
import { Button } from './ui'

interface DeleteChoiceDialogProps {
  title: string
  description: string
  onCorrection: () => void
  onSoftDelete: () => void
  onCancel: () => void
  /** When set, the plain soft-delete option is hidden and this explains why
   * (e.g. the movement's day already has a napi zárás sent) - only the
   * correction-entry path is offered. The store enforces this regardless
   * (see deleteMovement in useStore.ts), but hiding the option here avoids
   * offering a button that would silently behave differently than labeled. */
  correctionOnlyReason?: string
}

/** Shown wherever a movement or ledger entry can be "deleted" - nothing is
 * ever hard-deleted here, so the user picks between a proper accounting-
 * style correction entry (the original stays, a reversing entry neutralizes
 * it) or a straight soft-delete (hidden from view/totals, but restorable). */
export function DeleteChoiceDialog({ title, description, onCorrection, onSoftDelete, onCancel, correctionOnlyReason }: DeleteChoiceDialogProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-4 text-sm text-[var(--color-text)]">{description}</p>
      {correctionOnlyReason && (
        <p className="mb-4 rounded-lg bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">{correctionOnlyReason}</p>
      )}
      <div className="mb-4 space-y-2">
        <button
          type="button"
          onClick={onCorrection}
          className="w-full rounded-lg border border-[var(--color-primary)] bg-[var(--color-info-bg)] p-3 text-left transition-colors hover:opacity-90"
        >
          <div className="text-sm font-semibold text-[var(--color-primary)]">Korrekciós tétel létrehozása (ajánlott)</div>
          <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Az eredeti tétel megmarad, és egy azt semlegesítő, rá hivatkozó ellentétes tétel jön létre - teljes könyvelési nyomvonal marad.
          </div>
        </button>
        {!correctionOnlyReason && (
          <button
            type="button"
            onClick={onSoftDelete}
            className="w-full rounded-lg border border-[var(--color-border)] p-3 text-left transition-colors hover:bg-black/5"
          >
            <div className="text-sm font-semibold text-[var(--color-text)]">Egyszerű törlés</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              A tétel törölt állapotba kerül - nem vész el, bármikor visszaállítható -, és azonnal kikerül az összesítésekből.
            </div>
          </button>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Mégse
        </Button>
      </div>
    </Modal>
  )
}
