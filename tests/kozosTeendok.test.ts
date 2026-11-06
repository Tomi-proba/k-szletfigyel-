// @vitest-environment jsdom
// Közös Teendők és hivatkozások a Készlet felületén (TERV.md F18, I6.3): a programfüggetlen hivatkozás
// feloldása (ugyanabban a fülben nyíló cím; külső webcím soha), és a „honnan jött?” hivatkozás.
import { describe, expect, it } from 'vitest'
import { modulHivatkozas } from '../src/lib/integracio'

describe('programfüggetlen hivatkozás (I6)', () => {
  const cimek = { konyvelo: 'https://konyvelo.example/', eafa: undefined }

  it('a másik program beállított címére fordul le; cím nélkül csak szöveg (null)', () => {
    expect(modulHivatkozas({ module: 'konyvelo', path: '/konyveles/1?ceg=k1' }, cimek)).toBe('https://konyvelo.example/konyveles/1?ceg=k1')
    expect(modulHivatkozas({ module: 'eafa', path: '#/ugyfel/1' }, cimek)).toBeNull()
    expect(modulHivatkozas({ module: 'eafa', path: '#/ugyfel/1' }, { eafa: 'https://eafa.example' })).toBe('https://eafa.example/#/ugyfel/1')
    expect(modulHivatkozas(null, cimek)).toBeNull()
  })

  it('a Készlet saját útvonala a saját felületén belül marad', () => {
    expect(modulHivatkozas({ module: 'keszlet', path: '#/jovahagyasra-var' }, cimek)).toBe('#/jovahagyasra-var')
    expect(modulHivatkozas({ module: 'keszlet', path: '/riasztasok' }, cimek)).toBe('#/riasztasok')
  })

  it('külső webcímre vagy protokollra mutató útvonal nem lesz hivatkozás', () => {
    for (const path of ['https://rossz.example/', '//rossz.example/x', 'javascript:alert(1)', 'konyveles/1']) {
      expect(modulHivatkozas({ module: 'konyvelo', path }, cimek), path).toBeNull()
    }
  })
})

describe('hivatkozás a közös keretben (F26)', () => {
  it('a keret útvonala, ugyanazon a felületen: a Készlet saját útvonala előtaggal, a többi program a keret előtagjával', async () => {
    const { keretModBeallitas } = await import('../src/keret/futas')
    keretModBeallitas('/keszlet')
    try {
      expect(modulHivatkozas({ module: 'konyvelo', path: '/konyveles/1' })).toBe('/konyvelo/konyveles/1')
      expect(modulHivatkozas({ module: 'eafa', path: '#/bevallas/9' })).toBe('/afa/bevallas/9')
      expect(modulHivatkozas({ module: 'keszlet', path: '#/mozgasnaplo' })).toBe('/keszlet/mozgasnaplo')
      expect(modulHivatkozas({ module: 'konyvelo', path: '//idegen.example/x' })).toBeNull()
    } finally {
      keretModBeallitas('')
    }
  })
})

