// A jóváhagyandó tételek kártyáján a várható dátumok (a felhasználó kérése, minden szerepnél): rendelt árunál a várható
// beérkezés (a szállító szállítási ideje szerint), és a várható fizetés (a tételen megadott határidő, különben a vevő /
// szállító fizetési határideje szerint). Ami nem számolható, azt kiírjuk („nincs megadva”), nem marad el.
import type { Customer, Movement, Supplier } from '../types'

export interface DatumSor {
  /** pl. „Várható beérkezés” */
  cim: string
  /** ÉÉÉÉ-HH-NN, vagy null, ha nincs dátum (ilyenkor a megjegyzés mondja meg, miért) */
  datum: string | null
  megjegyzes?: string
  /** ha már elmúlt: a kártyán pirosan, ezzel a szóval („késik”, „lejárt”) */
  lejart?: string
}

export function napHozzaad(iso: string, napok: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + napok)
  return d.toISOString().slice(0, 10)
}

export function jovahagyandoDatumok(
  m: Movement,
  k: { szallito?: Supplier; vevo?: Customer; beszerzes: boolean; ma: string },
): DatumSor[] {
  const sorok: DatumSor[] = []
  const megjott = m.raktarVisszaigazolva ? (m.raktarMennyiseg ?? m.quantity) > 0 : null

  if (m.type === 'in' && k.beszerzes) {
    // Beérkezés
    if (megjott === true) {
      sorok.push({ cim: 'Beérkezett', datum: m.raktarVisszaigazolva!.slice(0, 10), megjegyzes: 'a raktár visszaigazolta' })
    } else if (megjott === false) {
      sorok.push({ cim: 'Beérkezés', datum: null, megjegyzes: 'a raktár szerint nem jött meg' })
    } else {
      const napok = k.szallito?.leadTimeDays
      if (napok && napok > 0) {
        const datum = napHozzaad(m.date, napok)
        sorok.push({ cim: 'Várható beérkezés', datum, megjegyzes: `a szállító ${napok} napos szállítási ideje szerint`, lejart: datum < k.ma ? 'késik' : undefined })
      } else {
        sorok.push({ cim: 'Várható beérkezés', datum: m.date, megjegyzes: k.szallito ? 'a rendelés napja (a szállítónál nincs szállítási idő megadva)' : 'a rendelés napja (még nincs szállító)', lejart: m.date < k.ma ? 'késik' : undefined })
      }
    }
    // Fizetés a szállítónak
    sorok.push(fizetes(m, k.szallito?.paymentTermDays, 'a szállító', k.ma))
    return sorok
  }

  if (m.type === 'out' && !m.ok) {
    sorok.push({ cim: 'Kiadás napja', datum: m.date })
    if (!m.customerId) {
      sorok.push({ cim: 'Fizetés', datum: m.date, megjegyzes: 'azonnal (vevő nélküli eladás)' })
    } else {
      sorok.push(fizetes(m, k.vevo?.paymentTermDays, 'a vevő', k.ma))
    }
    return sorok
  }

  // Leltár, selejt, visszáru, Könyvelőből jött tétel: a tétel napja.
  sorok.push({ cim: 'Dátum', datum: m.date })
  return sorok
}

function fizetes(m: Movement, hataridoNapok: number | undefined, kie: string, ma: string): DatumSor {
  if (m.isPaid === true) return { cim: 'Fizetés', datum: null, megjegyzes: 'fizetve' }
  if (m.dueDate) return { cim: 'Várható fizetés', datum: m.dueDate, megjegyzes: 'fizetési határidő', lejart: m.dueDate < ma ? 'lejárt' : undefined }
  if (hataridoNapok !== undefined && hataridoNapok !== null) {
    const datum = napHozzaad(m.date, hataridoNapok)
    return {
      cim: 'Várható fizetés',
      datum,
      megjegyzes: hataridoNapok === 0 ? `azonnal (${kie} fizetési határideje 0 nap)` : `${kie} ${hataridoNapok} napos fizetési határideje szerint`,
      lejart: datum < ma ? 'lejárt' : undefined,
    }
  }
  return { cim: 'Várható fizetés', datum: null, megjegyzes: `nincs megadva (${kie} fizetési határideje nincs beállítva)` }
}
