// A Mozgásnapló exportjának (Excel / PDF) sorai. A felhasználó kérése: minden rögzített sorban legyen adat –
// a bejövő és a kimenő sor ugyanazokat az oszlopokat tölti ki, a saját értelmével (pl. „Partner” = szállító vagy
// vevő, „Érték” = beszerzési érték vagy árbevétel). Ahol egy adat a sor fajtájára nem értelmezhető, ott ezt
// kiírjuk, nem marad üres cella.
import { lotUnitCost } from './costing'
import { formatNumber } from './format'
import type { Customer, Location, Movement, MovementReason, Product, PurchaseLot, SaleStatus, Supplier } from '../types'

export const OK_FELIRAT: Record<MovementReason, string> = { normal: '', leltar_hiany: 'Leltári hiány', leltar_tobblet: 'Leltári többlet', selejt: 'Selejt' }
export const ELADAS_STATUSZ: Record<SaleStatus, string> = { pending: 'Kiadásra vár', shipping: 'Kiszállítás alatt', delivered: 'Kézbesítve/átadva' }

/** Kimenő tétel értékei: eladási egységár (a tételé, különben a termék eladási ára), árbevétel,
 * ELÁBÉ (eladott áruk beszerzési értéke: az eladáskor rögzített egységköltség × mennyiség) és árrés. */
export function eladasErtekek(m: Movement, product: Product | undefined) {
  const sajat = m.saleUnitPrice
  const egysegar = sajat ?? product?.salePrice
  const arbevetel = egysegar !== undefined ? Math.round(egysegar * m.quantity) : undefined
  const elabe = m.unitCost !== undefined ? Math.round(m.unitCost * m.quantity) : undefined
  return { egysegar, termekArabol: sajat === undefined, arbevetel, elabe, arres: arbevetel !== undefined && elabe !== undefined ? arbevetel - elabe : undefined }
}

export interface MozgasExportSor {
  datum: string
  termek: string
  cikkszam: string
  telephely: string
  tipus: string
  mennyiseg: number
  egyseg: string
  partner: string
  egysegar: string | number
  szallitas: string | number
  penznem: string
  arfolyam: string | number
  egysegkoltseg: string | number
  ertek: string | number
  elabe: string | number
  arres: string | number
  maradek: string
  afa: string
  fizetve: string
  eladasStatusz: string
  allapot: string
  megjegyzes: string
}

export interface MozgasExportKornyezet {
  product?: Product
  lot?: PurchaseLot
  location?: Location
  customer?: Customer
  supplier?: Supplier
  /** Kimenő sornál: melyik beszerzésből fogyott (fifoForrasok). */
  forras?: FifoForras[]
  formatDate: (d: string) => string
}

export interface FifoForras {
  datum: string
  mennyiseg: number
}

/** Kimenő mozgásonként: mely beszerzési tételekből fogyott az áru, FIFO szerint (a legrégebbi beszerzés előbb).
 * A tételfelhasználást a program nem tárolja mozgásonként, ezért a mozgások időrendjéből számoljuk újra:
 * minden kimenő mozgás, amelynek van rögzített önköltsége (elfogadáskor fogyott a tételekből), a még meglévő
 * legrégebbi beszerzésekből vesz. A beszerzési tétel nélküli rész (pl. a tételkövetés előtti készlet) „korábbi
 * készlet”. */
export function fifoForrasok(movements: Movement[], lots: PurchaseLot[]): Map<string, FifoForras[]> {
  const ki = new Map<string, FifoForras[]>()
  const maradek = new Map<string, number>()
  const termekTetelei = new Map<string, PurchaseLot[]>()
  for (const l of lots) {
    maradek.set(l.id, l.quantity)
    termekTetelei.set(l.productId, [...(termekTetelei.get(l.productId) ?? []), l])
  }
  for (const t of termekTetelei.values()) t.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt)))
  const kimenok = movements
    .filter((m) => m.type === 'out' && m.unitCost !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt)))
  for (const m of kimenok) {
    let kell = m.quantity
    const sor: FifoForras[] = []
    for (const l of termekTetelei.get(m.productId) ?? []) {
      if (kell <= 0) break
      // Csak a mozgás napjáig beérkezett tétel adhat (a később rögzített beszerzés nem fogyhatott korábban).
      if (l.date > m.date) break
      const van = maradek.get(l.id) ?? 0
      if (van <= 0) continue
      const vesz = Math.min(van, kell)
      maradek.set(l.id, van - vesz)
      kell -= vesz
      sor.push({ datum: l.date, mennyiseg: vesz })
    }
    if (kell > 0) sor.push({ datum: '', mennyiseg: kell })
    ki.set(m.id, sor)
  }
  return ki
}

function forrasSzoveg(f: FifoForras[] | undefined, egyseg: string, formatDate: (d: string) => string): string {
  if (!f || f.length === 0) return 'elfogadáskor számolódik'
  return forrasLeiras(f, egyseg, formatDate)
}

/** „11. 07-i beszerzésből 45 kg; korábbi készletből 5 kg” */
export function forrasLeiras(f: FifoForras[], egyseg: string, formatDate: (d: string) => string = sajatDatum): string {
  return f
    .map((x) => (x.datum ? `${formatDate(x.datum).replace(/\.$/, '')}-i beszerzésből ${formatNumber(x.mennyiseg)} ${egyseg}` : `korábbi készletből ${formatNumber(x.mennyiseg)} ${egyseg}`))
    .join('; ')
}

const NINCS = 'nincs megadva'
/** ÉÉÉÉ-HH-NN → „HH. NN.” (a felületen az év a sor dátumából látszik). */
const sajatDatum = (d: string) => `${d.slice(5, 7)}. ${d.slice(8, 10)}.`
const kerek = (n: number) => Math.round(n)

export function mozgasExportSor(m: Movement, k: MozgasExportKornyezet): MozgasExportSor {
  const { product, lot } = k
  const be = m.type === 'in'
  const ok = m.ok ? OK_FELIRAT[m.ok] : ''
  const kozos = {
    datum: k.formatDate(m.date),
    termek: product?.name ?? 'Törölt termék',
    cikkszam: product?.sku || NINCS,
    telephely: k.location?.name ?? 'Törölt telephely',
    tipus: (be ? 'Bejövő' : 'Kimenő') + (ok ? ` (${ok})` : ''),
    mennyiseg: m.quantity,
    egyseg: product?.unit ?? NINCS,
    megjegyzes: m.note?.trim() || 'nincs',
    allapot: allapot(m),
  }

  if (be) {
    // Elfogadott beérkezésnél a beszerzési tétel adja az értékeket; még el nem fogadottnál a rögzített mozgás.
    const penznem = lot?.currency ?? m.currency ?? 'HUF'
    const arfolyam = lot?.exchangeRate ?? m.exchangeRate ?? 1
    const egysegar = lot?.unitPrice ?? m.unitPrice ?? product?.purchasePrice
    const szallitas = lot?.shippingCost ?? m.shippingCost ?? 0
    const afaKulcs = lot?.vatRatePercent ?? m.vatRatePercent
    const egysegkoltseg = lot
      ? lotUnitCost(lot)
      : egysegar !== undefined
        ? lotUnitCost({ unitPrice: egysegar, shippingCost: szallitas, quantity: m.quantity, exchangeRate: arfolyam, vatRatePercent: afaKulcs })
        : undefined
    const fizetve = lot?.isPaid ?? m.isPaid
    return {
      ...kozos,
      partner: k.supplier?.name ?? NINCS,
      egysegar: egysegar ?? NINCS,
      szallitas,
      penznem,
      arfolyam,
      egysegkoltseg: egysegkoltseg !== undefined ? kerek(egysegkoltseg) : NINCS,
      ertek: egysegkoltseg !== undefined ? kerek(egysegkoltseg * m.quantity) : NINCS,
      elabe: 'nem eladás',
      arres: 'nem eladás',
      maradek: lot ? `${formatNumber(lot.remainingQuantity)} / ${formatNumber(lot.quantity)}` : 'elfogadás után',
      afa: afaKulcs === undefined ? NINCS : `${afaKulcs}%${lot?.vatReclaimable === false ? ' (nem visszaig.)' : ' (visszaig.)'}`,
      fizetve: fizetve === undefined ? NINCS : fizetve ? 'Fizetve' : 'Nem fizetett',
      eladasStatusz: 'nem eladás',
    }
  }

  const e = eladasErtekek(m, product)
  const afaKulcs = m.vatRatePercent ?? product?.defaultVatRatePercent
  const fuggo = 'elfogadáskor számolódik'
  if (ok) {
    // Leltári hiány / selejt: nem eladás – nincs vevő, ár, árbevétel; az önköltség (a kiesett áru értéke) igen.
    const ne = 'nem eladás'
    return {
      ...kozos,
      partner: ne, egysegar: ne, szallitas: 0, penznem: 'HUF', arfolyam: 1,
      egysegkoltseg: m.unitCost !== undefined ? kerek(m.unitCost) : fuggo,
      ertek: m.unitCost !== undefined ? kerek(m.unitCost * m.quantity) : fuggo,
      elabe: ne, arres: ne, maradek: forrasSzoveg(k.forras, kozos.egyseg, k.formatDate), afa: ne, fizetve: ne, eladasStatusz: ne,
    }
  }
  return {
    ...kozos,
    partner: m.customerId ? (k.customer?.name ?? 'Törölt vevő') : 'vevő nélküli eladás',
    egysegar: e.egysegar ?? NINCS,
    szallitas: 0,
    penznem: 'HUF',
    arfolyam: 1,
    egysegkoltseg: m.unitCost !== undefined ? kerek(m.unitCost) : fuggo,
    ertek: e.arbevetel ?? NINCS,
    elabe: e.elabe ?? fuggo,
    arres: e.arres ?? fuggo,
    maradek: forrasSzoveg(k.forras, kozos.egyseg, k.formatDate),
    afa: afaKulcs === undefined ? NINCS : `${afaKulcs}%${m.vatRatePercent === undefined ? ' (a termék alapértéke)' : ''}`,
    fizetve: m.customerId ? (m.isPaid ? 'Fizetve' : 'Nem fizetett') : 'azonnal (vevő nélkül)',
    eladasStatusz: m.cancelled ? 'Visszavonva' : m.saleStatus ? ELADAS_STATUSZ[m.saleStatus] : ELADAS_STATUSZ.pending,
  }
}

function allapot(m: Movement): string {
  if (m.deletedAt) return 'Törölve'
  if (m.cancelled) return `Visszavonva${m.cancelReason ? ` (${m.cancelReason})` : ''}`
  if (m.approvalStatus === 'pending') return 'Jóváhagyásra vár'
  if (m.approvalStatus === 'rejected') return `Elutasítva${m.rejectReason ? ` (${m.rejectReason})` : ''}`
  if (m.correctsMovementId) return 'Érvényes (javítás)'
  return 'Érvényes'
}
