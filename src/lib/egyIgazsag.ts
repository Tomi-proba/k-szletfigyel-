// Egy igazság a fizetési kötelezettségekben és a kintlévőségben (TERV.md F19, I6b, KK10).
//
// Ha a cégnek van Könyvelője, a Készlet a Könyvelő nyitott tételeit mutatja, és a saját tételeit három
// csoportba sorolja, hogy semmi ne vesszen el csendben és semmi ne szerepeljen kétszer:
//   1. konyvelo:        a Könyvelő nyitott tétele (a fizetést a Könyvelőben rögzítik, KK6);
//   2. konyvelesre_var: a Készlet tétele, amelyről a Könyvelő tud, de még nincs könyvelve;
//   3. csak_keszlet:    a Könyvelő legutóbbi listájában nem szerepel (pl. az összekapcsolás előtti tétel,
//                       vagy még átadás alatt van), és a pénzügyi napló határidős kiadásai.
// A program nem talál ki határidőt: a határidő nélküli Könyvelő-tétel „nincs határidő” jelzést kap, és a
// riasztásban nem számít.
import type { UnpaidSale } from './alerts'
import { daysBetween, todayISO } from './dates'
import { modulHivatkozas, type ModulHivatkozas } from './integracio'
import type { PayableObligation } from './payables'
import type { PurchaseLot } from '../types'

/** Ennél régebbi lista mellett figyelmeztetünk (a lista ilyenkor is látszik). */
export const ELAVULT_ORA = 24

type ForrasRef = { recordType: string; recordId: string }

export type KonyveloTetel = {
  kind: 'PAYABLE' | 'RECEIVABLE'
  documentId: string
  serialNumber: string | null
  externalNumber: string | null
  partnerName: string | null
  description: string | null
  issueDate: string | null
  dueDate: string | null
  /** fillér */
  open: number
  link: ModulHivatkozas | null
  stockSources: ForrasRef[]
}

export type KonyveloNyitott = {
  allapot: 'OK' | 'KOZPONT_NEM_ERHETO_EL' | 'NINCS_ADAT' | 'NINCS_KONYVELO' | 'NINCS_JOGOSULTSAG'
  asOf?: string | null
  kuldve?: string | null
  lekerve?: string | null
  items?: KonyveloTetel[]
  pendingDrafts?: Array<{ kind: 'PAYABLE' | 'RECEIVABLE'; documentId: string | null; link: ModulHivatkozas | null; stockSources: ForrasRef[] }>
}

export type Csoport = 'konyvelo' | 'konyvelesre_var' | 'csak_keszlet'

export const CSOPORT_CIM: Record<Csoport, string> = {
  konyvelo: 'A Könyvelő nyitott tételei',
  konyvelesre_var: 'Könyvelésre vár',
  csak_keszlet: 'Csak a Készletben rögzítve',
}

export const CSOPORT_MAGYARAZAT: Record<Csoport, string> = {
  konyvelo: 'A fizetést a Könyvelőben rögzítik; itt nem állítható.',
  konyvelesre_var: 'A Könyvelő tud róla, de még nincs könyvelve (a beszerzés számlája piszkozat, illetve az eladáshoz még nincs vevőszámla).',
  csak_keszlet: 'A Könyvelő legutóbbi listájában nem szerepel. Ha a Könyvelőben is könyvelték, ott is szerepel.',
}

export interface EgyIgazsagSor {
  kulcs: string
  oldal: 'fizetendo' | 'kintlevoseg'
  csoport: Csoport
  partner: string
  leiras: string
  /** forint */
  osszeg: number
  /** null: nincs határidő (a program nem talál ki határidőt) */
  hatarido: string | null
  /** negatív: lejárt; null: nincs határidő */
  napHataridoig: number | null
  /** a riasztásban (jelvényben) számít-e */
  riaszt: boolean
  hivatkozas: string | null
  /** a Készlet saját tétele (a „Kifizetve” jelöléshez) */
  helyi: { fizetendo: PayableObligation } | { eladas: UnpaidSale } | null
}

export interface EgyIgazsag {
  allapot: 'OK' | 'KOZPONT_NEM_ERHETO_EL' | 'NINCS_ADAT'
  elavult: boolean
  /** a lista legrégebbi időpontja (a Könyvelő küldése vagy a letöltés), ISO */
  frissitve: string | null
  fizetendo: EgyIgazsagSor[]
  kintlevoseg: EgyIgazsagSor[]
}

const SORREND: Record<Csoport, number> = { konyvelo: 0, konyvelesre_var: 1, csak_keszlet: 2 }

function rendez(a: EgyIgazsagSor, b: EgyIgazsagSor): number {
  if (a.csoport !== b.csoport) return SORREND[a.csoport] - SORREND[b.csoport]
  // a határidő nélküliek a csoport végére
  if (a.hatarido === null || b.hatarido === null) return a.hatarido === b.hatarido ? 0 : a.hatarido === null ? 1 : -1
  return a.hatarido < b.hatarido ? -1 : a.hatarido > b.hatarido ? 1 : 0
}

/**
 * Az összevont lista; null, ha nincs Könyvelő-lista (ekkor a Készlet a saját számítását mutatja, mint eddig).
 * `fizetendo`: a Készlet saját fizetési kötelezettségei (computePayableObligations); `eladasok`: a kifizetetlen
 * eladások (computeUnpaidSales); `lots`: a beszerzési tételek (a mozgáshoz kötéshez).
 */
export function egyIgazsag(
  k: KonyveloNyitott | null,
  fizetendo: PayableObligation[],
  eladasok: UnpaidSale[],
  lots: PurchaseLot[],
  reminderWindowDays: number,
  most: Date = new Date(),
  cimek?: Parameters<typeof modulHivatkozas>[1],
): EgyIgazsag | null {
  if (!k || (k.allapot !== 'OK' && k.allapot !== 'KOZPONT_NEM_ERHETO_EL' && k.allapot !== 'NINCS_ADAT')) return null
  const ma = todayISO()
  const items = k.items ?? []
  const pending = k.pendingDrafts ?? []
  // Mely Készlet-mozgások vannak a Könyvelő nyitott tételeiben, és melyek várnak könyvelésre.
  const benne = new Set(items.flatMap((i) => i.stockSources.map((s) => s.recordId)))
  const var_ = new Set(pending.flatMap((p) => p.stockSources.map((s) => s.recordId)))
  const lotMozgas = new Map(lots.map((l) => [l.id, l.movementId]))

  const konyveloSor = (i: KonyveloTetel): EgyIgazsagSor => {
    const nap = i.dueDate ? daysBetween(ma, i.dueDate) : null
    const fizetendoOldal = i.kind === 'PAYABLE'
    return {
      kulcs: `k:${i.kind}:${i.documentId}:${i.open}`,
      oldal: fizetendoOldal ? 'fizetendo' : 'kintlevoseg',
      csoport: 'konyvelo',
      partner: i.partnerName ?? (fizetendoOldal ? 'Ismeretlen szállító' : 'Ismeretlen vevő'),
      leiras: [i.serialNumber, i.externalNumber ? `(${i.externalNumber})` : null, i.description].filter(Boolean).join(' ') || 'Bizonylat',
      osszeg: i.open / 100,
      hatarido: i.dueDate,
      napHataridoig: nap,
      riaszt: nap !== null && (nap < 0 || (fizetendoOldal && nap <= reminderWindowDays)),
      hivatkozas: modulHivatkozas(i.link, cimek),
      helyi: null,
    }
  }

  const fizetendoSorok: EgyIgazsagSor[] = items.filter((i) => i.kind === 'PAYABLE').map(konyveloSor)
  for (const p of fizetendo) {
    const mozgas = p.sourceType === 'purchase' ? lotMozgas.get(p.id) : undefined
    if (mozgas && benne.has(mozgas)) continue // a Könyvelő nyitott tételében már szerepel
    const csoport: Csoport = mozgas && var_.has(mozgas) ? 'konyvelesre_var' : 'csak_keszlet'
    fizetendoSorok.push({
      kulcs: `h:${p.sourceType}:${p.id}`,
      oldal: 'fizetendo',
      csoport,
      partner: p.payee,
      leiras: p.description,
      osszeg: p.amount,
      hatarido: p.dueDate,
      napHataridoig: p.daysUntilDue,
      riaszt: p.isAlertWorthy,
      hivatkozas: null,
      helyi: { fizetendo: p },
    })
  }

  const kintlevosegSorok: EgyIgazsagSor[] = items.filter((i) => i.kind === 'RECEIVABLE').map(konyveloSor)
  for (const s of eladasok) {
    if (benne.has(s.movementId)) continue
    kintlevosegSorok.push({
      kulcs: `h:eladas:${s.movementId}`,
      oldal: 'kintlevoseg',
      csoport: var_.has(s.movementId) ? 'konyvelesre_var' : 'csak_keszlet',
      partner: s.customerName,
      leiras: `${s.productName} · ${s.quantity} ${s.unit} · ${s.date}`,
      osszeg: s.amount,
      // A Készlet eladásának nincs fizetési határideje: nem találunk ki (mint eddig, a kifizetetlen eladás riaszt).
      hatarido: null,
      napHataridoig: null,
      riaszt: true,
      hivatkozas: null,
      helyi: { eladas: s },
    })
  }

  const idopontok = [k.kuldve, k.lekerve].filter((x): x is string => Boolean(x)).map((x) => Date.parse(x))
  const frissitve = idopontok.length ? new Date(Math.min(...idopontok)).toISOString() : null
  const elavult = frissitve !== null && most.getTime() - Date.parse(frissitve) > ELAVULT_ORA * 3_600_000
  return {
    allapot: k.allapot,
    elavult,
    frissitve,
    fizetendo: fizetendoSorok.sort(rendez),
    kintlevoseg: kintlevosegSorok.sort(rendez),
  }
}
