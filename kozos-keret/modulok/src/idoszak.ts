// A keret közös időszaka (TERV.md F22 K2, K4): év, és azon belül hónap, negyedév vagy egész év. A modulok a
// saját fogalmukra fordítják (Könyvelő: üzleti év és hónap; eÁFA: bevallási időszak; Készlet: dátumtartomány).
//
// Alapértelmezés modulonként, a cég beállításai szerint (jóváhagyva 2026-11-05):
//   - eÁFA: a cég bevallási gyakorisága szerinti legutóbbi, még be nem küldött időszak;
//   - Könyvelő: a folyó üzleti év és hónap;
//   - Készlet: a folyó hónap.
// Ha a felhasználó választ, a választása cégenként megmarad, modulváltáskor is (a modul a saját
// gyakoriságára igazítja, pl. negyedéves bevallónál a hónapot tartalmazó negyedév).

export type IdoszakFajta = 'honap' | 'negyedev' | 'ev'

export interface Idoszak {
  ev: number
  fajta: IdoszakFajta
  /** Hónap: 1–12; negyedév: 1–4; egész év: 1. */
  szam: number
}

export type Gyakorisag = 'havi' | 'negyedeves' | 'eves'

export const GYAKORISAG_FAJTA: Record<Gyakorisag, IdoszakFajta> = { havi: 'honap', negyedeves: 'negyedev', eves: 'ev' }

const HONAPOK = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december']
const ROMAI = ['I.', 'II.', 'III.', 'IV.']

export function ervenyes(i: Idoszak): boolean {
  if (!Number.isInteger(i.ev) || i.ev < 2000 || i.ev > 2100 || !Number.isInteger(i.szam)) return false
  if (i.fajta === 'honap') return i.szam >= 1 && i.szam <= 12
  if (i.fajta === 'negyedev') return i.szam >= 1 && i.szam <= 4
  return i.fajta === 'ev' && i.szam === 1
}

/** Rövid, URL-be és tárolóba írható kulcs: 2026-11, 2026-N4, 2026. */
export function idoszakKulcs(i: Idoszak): string {
  if (i.fajta === 'honap') return `${i.ev}-${String(i.szam).padStart(2, '0')}`
  if (i.fajta === 'negyedev') return `${i.ev}-N${i.szam}`
  return String(i.ev)
}

export function idoszakOlvas(kulcs: string | null | undefined): Idoszak | null {
  if (!kulcs) return null
  let m = /^(\d{4})-(\d{2})$/.exec(kulcs)
  let i: Idoszak | null = null
  if (m) i = { ev: Number(m[1]), fajta: 'honap', szam: Number(m[2]) }
  else if ((m = /^(\d{4})-N([1-4])$/.exec(kulcs))) i = { ev: Number(m[1]), fajta: 'negyedev', szam: Number(m[2]) }
  else if ((m = /^(\d{4})$/.exec(kulcs))) i = { ev: Number(m[1]), fajta: 'ev', szam: 1 }
  return i && ervenyes(i) ? i : null
}

export function idoszakSzoveg(i: Idoszak): string {
  if (i.fajta === 'honap') return `${i.ev}. ${HONAPOK[i.szam - 1]}`
  if (i.fajta === 'negyedev') return `${i.ev}. ${ROMAI[i.szam - 1]} negyedév`
  return `${i.ev}. év`
}

const ket = (n: number) => String(n).padStart(2, '0')
const napokSzama = (ev: number, honap: number) => new Date(Date.UTC(ev, honap, 0)).getUTCDate()

/** Az időszak első és utolsó napja (ÉÉÉÉ-HH-NN). */
export function tartomany(i: Idoszak): { tol: string; ig: string } {
  const [h1, h2] = i.fajta === 'honap' ? [i.szam, i.szam] : i.fajta === 'negyedev' ? [i.szam * 3 - 2, i.szam * 3] : [1, 12]
  return { tol: `${i.ev}-${ket(h1)}-01`, ig: `${i.ev}-${ket(h2)}-${ket(napokSzama(i.ev, h2))}` }
}

/** A dátumot tartalmazó időszak (helyi naptár szerint). */
export function tartalmazo(d: Date, fajta: IdoszakFajta): Idoszak {
  const ev = d.getFullYear()
  const h = d.getMonth() + 1
  if (fajta === 'honap') return { ev, fajta, szam: h }
  if (fajta === 'negyedev') return { ev, fajta, szam: Math.ceil(h / 3) }
  return { ev, fajta, szam: 1 }
}

export function elozo(i: Idoszak): Idoszak {
  if (i.fajta === 'ev') return { ...i, ev: i.ev - 1 }
  const max = i.fajta === 'honap' ? 12 : 4
  return i.szam > 1 ? { ...i, szam: i.szam - 1 } : { ...i, ev: i.ev - 1, szam: max }
}

export function kovetkezo(i: Idoszak): Idoszak {
  if (i.fajta === 'ev') return { ...i, ev: i.ev + 1 }
  const max = i.fajta === 'honap' ? 12 : 4
  return i.szam < max ? { ...i, szam: i.szam + 1 } : { ...i, ev: i.ev + 1, szam: 1 }
}

const elsoHonap = (i: Idoszak) => (i.fajta === 'honap' ? i.szam : i.fajta === 'negyedev' ? i.szam * 3 - 2 : 1)
const utolsoHonap = (i: Idoszak) => (i.fajta === 'honap' ? i.szam : i.fajta === 'negyedev' ? i.szam * 3 : 12)

/**
 * A választott időszak a modul fajtájára igazítva: durvábbra a tartalmazó időszak (a novemberből a IV.
 * negyedév), finomabbra a benne lévő folyó időszak, ha a mai nap beleesik, különben az utolsó (a 2025. évből
 * havi bontásban 2025. december).
 */
export function igazit(i: Idoszak, fajta: IdoszakFajta, ma: Date = new Date()): Idoszak {
  if (i.fajta === fajta) return i
  const most = tartalmazo(ma, fajta)
  const h1 = elsoHonap(i)
  const h2 = utolsoHonap(i)
  const benne = (h: number) => h >= h1 && h <= h2
  if (fajta === 'ev') return { ev: i.ev, fajta, szam: 1 }
  if (fajta === 'negyedev') {
    if (i.fajta === 'honap') return { ev: i.ev, fajta, szam: Math.ceil(i.szam / 3) }
    return most.ev === i.ev && benne(most.szam * 3) ? most : { ev: i.ev, fajta, szam: 4 }
  }
  // havi bontás egy negyedévből vagy évből
  return most.ev === i.ev && benne(most.szam) ? most : { ev: i.ev, fajta, szam: h2 }
}

/**
 * eÁFA: a cég bevallási gyakorisága szerinti legutóbbi, még be nem küldött időszak. A legutóbb lezárult
 * időszak, ha még nincs beküldve; ha már be van, a folyó időszak (a korábbi elmaradtak Teendőként jelennek
 * meg, nem itt).
 */
export function afaAlapIdoszak(o: { gyakorisag: Gyakorisag; bekuldott: readonly string[]; ma?: Date }): Idoszak {
  const fajta = GYAKORISAG_FAJTA[o.gyakorisag]
  const folyo = tartalmazo(o.ma ?? new Date(), fajta)
  const lezarult = elozo(folyo)
  return o.bekuldott.includes(idoszakKulcs(lezarult)) ? folyo : lezarult
}

export interface UzletiEv {
  /** Az üzleti év első és utolsó napja (ÉÉÉÉ-HH-NN). */
  kezdet: string
  veg: string
}

/**
 * Könyvelő: a folyó üzleti év és hónap. Ha a mai nap egyik felvett üzleti évbe sem esik, a legutóbbi üzleti év
 * utolsó hónapja; üzleti év nélkül a folyó hónap.
 */
export function konyveloAlapIdoszak(o: { uzletiEvek: readonly UzletiEv[]; ma?: Date }): Idoszak {
  const ma = o.ma ?? new Date()
  const nap = `${ma.getFullYear()}-${ket(ma.getMonth() + 1)}-${ket(ma.getDate())}`
  const folyo = tartalmazo(ma, 'honap')
  if (!o.uzletiEvek.length || o.uzletiEvek.some((u) => u.kezdet <= nap && nap <= u.veg)) return folyo
  const korabbiak = o.uzletiEvek.filter((u) => u.veg < nap).sort((a, b) => b.veg.localeCompare(a.veg))
  const ref = korabbiak[0] ?? [...o.uzletiEvek].sort((a, b) => a.kezdet.localeCompare(b.kezdet))[0]!
  const d = korabbiak[0] ? ref.veg : ref.kezdet
  return { ev: Number(d.slice(0, 4)), fajta: 'honap', szam: Number(d.slice(5, 7)) }
}

/** Készlet: a folyó hónap. */
export function keszletAlapIdoszak(o: { ma?: Date } = {}): Idoszak {
  return tartalmazo(o.ma ?? new Date(), 'honap')
}

/**
 * A modulnak átadott időszak: a felhasználó választása (a modul fajtájára igazítva), vagy ha nem választott,
 * a modul saját alapértelmezése.
 */
export function modulIdoszak(valasztott: Idoszak | null, modulFajta: IdoszakFajta | null, alap: () => Idoszak, ma?: Date): Idoszak {
  if (!valasztott) return alap()
  return modulFajta ? igazit(valasztott, modulFajta, ma) : valasztott
}
