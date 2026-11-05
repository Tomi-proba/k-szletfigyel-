// Párbeszéd- és megerősítő ablak összetevőkből (TERV.md F23 KB1): a böngésző saját modális <dialog> elemére
// épül (a fókusz az ablakban marad, Esc bezárja, bezáráskor a fókusz visszatér). Az összetevők neve és
// viselkedése a modulokban eddig használt párbeszédablakéval egyezik (Root, Trigger, Content, Title,
// Description, Close), így a modulok a közös ablakra a hívások átírása nélkül állhatnak át.
import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

interface AblakAllapot {
  /** Van-e leírás (Description) az ablakban: csak akkor kötjük az aria-describedby-hoz. */
  leirasVan: boolean
  leirasJelzes: (van: boolean) => void
  nyitva: boolean
  nyit: (n: boolean) => void
  cimId: string
  leirasId: string
  figyelmeztetes: boolean
}

const Ctx = createContext<AblakAllapot | null>(null)
const useAblak = () => {
  const a = useContext(Ctx)
  if (!a) throw new Error('Az ablak részei csak az Ablak.Root-on belül használhatók.')
  return a
}

function Root({
  open,
  defaultOpen = false,
  onOpenChange,
  figyelmeztetes = false,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (n: boolean) => void
  /** Megerősítő ablak (role="alertdialog"): kattintás mellé nem zárja be. */
  figyelmeztetes?: boolean
  children: ReactNode
}) {
  const [belso, setBelso] = useState(defaultOpen)
  const nyitva = open ?? belso
  const nyit = useCallback(
    (n: boolean) => {
      if (open === undefined) setBelso(n)
      onOpenChange?.(n)
    },
    [open, onOpenChange],
  )
  const id = useId()
  const [leirasVan, leirasJelzes] = useState(false)
  return <Ctx.Provider value={{ nyitva, nyit, cimId: `${id}-cim`, leirasId: `${id}-leiras`, figyelmeztetes, leirasVan, leirasJelzes }}>{children}</Ctx.Provider>
}

type Gyerek = ReactElement<{ onClick?: (e: MouseEvent) => void; id?: string }>

function lancoltKattintas(gyerek: Gyerek, f: () => void) {
  return cloneElement(gyerek, {
    onClick: (e: MouseEvent) => {
      gyerek.props.onClick?.(e)
      if (!e.defaultPrevented) f()
    },
  })
}

function Trigger({ asChild, children }: { asChild?: boolean; children: ReactNode }) {
  const a = useAblak()
  if (asChild && isValidElement(children)) return lancoltKattintas(children as Gyerek, () => a.nyit(true))
  return (
    <button type="button" onClick={() => a.nyit(true)}>
      {children}
    </button>
  )
}

function Close({ asChild, children }: { asChild?: boolean; children: ReactNode }) {
  const a = useAblak()
  if (asChild && isValidElement(children)) return lancoltKattintas(children as Gyerek, () => a.nyit(false))
  return (
    <button type="button" onClick={() => a.nyit(false)}>
      {children}
    </button>
  )
}

/** A böngésző modális ablaka a felső rétegben jelenik meg: külön „portál” nem kell. */
const Portal = ({ children }: { children: ReactNode }) => <>{children}</>
/** A háttér a <dialog> ::backdrop rétege (felulet.css). */
const Overlay = (_: { className?: string }) => null

function Content({ className, children, ...p }: DialogHTMLAttributes<HTMLDialogElement>) {
  const a = useAblak()
  const ref = useRef<HTMLDialogElement>(null)
  // Előbb az üres ablak nyílik meg modálisan, és csak utána kerül bele a tartalom: így a tartalomban kért
  // kezdő fókusz (autoFocus) a már megnyitott ablakban érvényesül.
  const [megnyitva, setMegnyitva] = useState(false)
  useEffect(() => {
    const d = ref.current
    if (a.nyitva && d && !d.open) d.showModal()
    setMegnyitva(a.nyitva)
  }, [a.nyitva])
  if (!a.nyitva) return null
  return (
    <dialog
      {...p}
      ref={ref}
      className={['fg-ablak', className].filter(Boolean).join(' ')}
      role={a.figyelmeztetes ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={a.cimId}
      aria-describedby={'aria-describedby' in p ? p['aria-describedby'] : a.leirasVan ? a.leirasId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        a.nyit(false)
      }}
      onClick={(e) => {
        p.onClick?.(e)
        // Kattintás az ablakon kívülre (a háttérre): bezár, a megerősítő ablak kivételével.
        if (!a.figyelmeztetes && e.target === ref.current) a.nyit(false)
      }}
    >
      {megnyitva ? children : null}
    </dialog>
  )
}

function cimkezett(nev: 'cimId' | 'leirasId', alap: 'h2' | 'p') {
  return function Resz({ asChild, children, ...p }: HTMLAttributes<HTMLElement> & { asChild?: boolean }) {
    const a = useAblak()
    const jelez = a.leirasJelzes
    useEffect(() => {
      if (nev !== 'leirasId') return
      jelez(true)
      return () => jelez(false)
    }, [jelez])
    if (asChild && isValidElement(children)) return cloneElement(children as Gyerek, { id: a[nev] })
    const El = alap
    return (
      <El {...p} id={a[nev]}>
        {children}
      </El>
    )
  }
}

export const Ablak = {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title: cimkezett('cimId', 'h2'),
  Description: cimkezett('leirasId', 'p'),
  Close,
  Cancel: Close,
}

/**
 * Megerősítés veszélyes műveletekhez (törlés, eltávolítás, zárás). Leírja a következményt; a fókusz alapból a
 * „Mégse” gombon van, így Enterrel nem lehet véletlenül jóváhagyni.
 */
export function Megerosites({
  kivalto,
  cim,
  leiras,
  megerositesFelirat,
  onMegerosites,
  veszelyes = true,
}: {
  kivalto: ReactNode
  cim: string
  leiras: ReactNode
  megerositesFelirat: string
  onMegerosites: () => Promise<unknown> | void
  veszelyes?: boolean
}) {
  const [nyitva, setNyitva] = useState(false)
  const [dolgozik, setDolgozik] = useState(false)
  return (
    <Ablak.Root open={nyitva} onOpenChange={setNyitva} figyelmeztetes>
      <Ablak.Trigger asChild>{kivalto}</Ablak.Trigger>
      <Ablak.Content className="fg-parbeszed dialog">
        <Ablak.Title>{cim}</Ablak.Title>
        <Ablak.Description asChild>
          <div>{leiras}</div>
        </Ablak.Description>
        <div className="fg-parbeszed__lab dialog-actions">
          <Ablak.Close asChild>
            <button type="button" className="fg-gomb fg-gomb--alap btn" autoFocus>
              Mégse
            </button>
          </Ablak.Close>
          <button
            type="button"
            className={veszelyes ? 'fg-gomb fg-gomb--veszelyes btn btn-danger-solid' : 'fg-gomb fg-gomb--elsodleges btn btn-primary'}
            disabled={dolgozik}
            onClick={async () => {
              setDolgozik(true)
              try {
                await onMegerosites()
                setNyitva(false)
              } finally {
                setDolgozik(false)
              }
            }}
          >
            {megerositesFelirat}
          </button>
        </div>
      </Ablak.Content>
    </Ablak.Root>
  )
}
