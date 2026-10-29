// A korábbi (véletlen portos) indítások alatt tárolt Készlet-adatok megkeresése (csak olvasás).
'use strict'

const { readLocalStorage } = require('./leveldb.js')

const ADAT_KULCS = 'keszletfigyelo-storage'
const SOR_KULCS = 'keszletfigyelo-mentesi-sor'
const REGI_CIM = /^http:\/\/127\.0\.0\.1:\d+$/

function szamol(nyers) {
  try {
    const s = JSON.parse(nyers).state || {}
    const n = (x) => (Array.isArray(x) ? x.length : 0)
    return { termekek: n(s.products), mozgasok: n(s.movements), telephelyek: n(s.locations), naploTetelek: n(s.ledgerEntries), beszallitok: n(s.suppliers) }
  } catch {
    return null
  }
}

/**
 * A régi címek alatti, Készlet-adatot tartalmazó tárolók, a legutóbb módosított elöl. A mostani cím
 * (az új, állandó cím) soha nincs a listában.
 */
function regiAdatokKeresese(tarolodir) {
  const talalatok = []
  for (const [cim, t] of readLocalStorage(tarolodir)) {
    if (!REGI_CIM.test(cim)) continue
    const adat = t.adatok.get(ADAT_KULCS) ?? null
    const sor = t.adatok.get(SOR_KULCS) ?? null
    if (!adat && !sor) continue
    let fuggoMentesek = 0
    try {
      fuggoMentesek = sor ? (JSON.parse(sor).tetelek || []).length : 0
    } catch {
      fuggoMentesek = 0
    }
    talalatok.push({ cim, modositva: t.modositva ? t.modositva.toISOString() : null, osszesites: adat ? szamol(adat) : null, fuggoMentesek, adat, sor })
  }
  return talalatok.sort((a, b) => String(b.modositva ?? '').localeCompare(String(a.modositva ?? '')))
}

module.exports = { regiAdatokKeresese, ADAT_KULCS, SOR_KULCS }
