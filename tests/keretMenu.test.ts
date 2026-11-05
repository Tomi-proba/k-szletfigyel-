// A Készletkezelő menüje a keretben (AWEBOLDAL TERV.md F24 KS7): a Könyvelő mintája (főpont + második menüsor);
// iroda 7 pont alpontokkal, raktáros 6 egyszerű pont; számlálók.
import { describe, expect, it } from 'vitest'
import { aktivCsoport, csoportPontjai, keszletMenu } from '../src/keret/menu'

const sz = { jovahagyasraVar: 2, modositasiKerelmek: 3, napiZarasok: 1, riasztasok: 7 }

describe('a Készletkezelő menüje a keretben', () => {
  it('raktáros: 6 egyszerű pont, a jóváhagyásra várók és a riasztások számával', () => {
    const m = keszletMenu('raktaros', sz)
    expect(m.map((p) => p.cim)).toEqual(['Kezdőlap', 'Jóváhagyásra vár', 'Riasztások', 'Termékek', 'Mozgásnapló', 'Napi zárás'])
    expect(m.find((p) => p.cim === 'Jóváhagyásra vár')?.szamlalo).toBe(2)
    expect(m.find((p) => p.cim === 'Riasztások')?.szamlalo).toBe(7)
    expect(aktivCsoport('/keszlet', 'raktaros')).toBeNull()
  })

  it('fő iroda: 7 pont; a csoportok alpontjai a fülsorban; a jóváhagyás számlálója a rá vár tételeket is mutatja', () => {
    const m = keszletMenu('fo_iroda', sz)
    expect(m.map((p) => p.cim)).toEqual(['Áttekintés', 'Jóváhagyás', 'Készlet', 'Partnerek', 'Pénzügy', 'Riasztások', 'Beállítások'])
    expect(m.find((p) => p.cim === 'Jóváhagyás')?.szamlalo).toBe(6)
    expect(m.find((p) => p.cim === 'Készlet')).toMatchObject({ utvonal: '/keszlet', alutvonalak: ['/mozgasnaplo', '/napi-zaras'] })
    expect(aktivCsoport('/mozgasnaplo', 'fo_iroda')).toBe('keszlet')
    expect(csoportPontjai('jovahagyas', 'fo_iroda').map((p) => p.utvonal)).toEqual(['/jovahagyasra-var', '/jovahagyasok', '/napi-jelentesek'])
  })

  it('iroda és tulajdonos: a fő irodai törzsadat-kérések pontja nélkül; a tulajdonos a Csapatot sem kezeli', () => {
    expect(csoportPontjai('jovahagyas', 'iroda').map((p) => p.utvonal)).toEqual(['/jovahagyasra-var', '/napi-jelentesek'])
    expect(keszletMenu('iroda', sz).find((p) => p.cim === 'Jóváhagyás')?.szamlalo).toBe(3)
    expect(csoportPontjai('beallitasok', 'tulajdonos').map((p) => p.cim)).toEqual(['Beállítások', 'Telephelyek', 'Audit napló'])
  })
})
