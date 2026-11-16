// A Mozgásnapló kimenő soraiban: eladási ár, árbevétel, ELÁBÉ (eladáskor rögzített egységköltség × mennyiség), árrés.
import { describe, expect, it } from 'vitest'
import { eladasErtekek } from '../src/pages/Movements'
import type { Movement, Product } from '../src/types'

const termek = { salePrice: 490 } as Product
const m = (x: Partial<Movement>) => ({ type: 'out', quantity: 10, ...x }) as Movement

describe('eladás értékei', () => {
  it('a tétel eladási ára, ELÁBÉ és árrés', () => {
    expect(eladasErtekek(m({ saleUnitPrice: 500, unitCost: 300 }), termek)).toEqual({ egysegar: 500, termekArabol: false, arbevetel: 5000, elabe: 3000, arres: 2000 })
  })
  it('ár nélkül a termék eladási ára; egységköltség nélkül nincs ELÁBÉ (még nincs elfogadva)', () => {
    expect(eladasErtekek(m({}), termek)).toEqual({ egysegar: 490, termekArabol: true, arbevetel: 4900, elabe: undefined, arres: undefined })
  })
})
