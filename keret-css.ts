// A Készletkezelő stílusa a keretben (AWEBOLDAL TERV.md F24 KS6): minden szabály a Készlet dobozára szűkül, így a
// keretet (fejléc, menü, a többi modul) nem írja át – a Tailwind elemszintű alapstílusa (preflight) sem. A :root,
// html és body szabályai magára a dobozra vonatkoznak.
import postcss, { type AtRule, type Plugin, type Rule } from 'postcss'

export const KESZLET_DOBOZ = '[data-modul-keretben="keszlet"]'

export function szukitettSelektor(s: string, doboz = KESZLET_DOBOZ): string {
  const t = s.trim()
  const m = /^(:root|html|body)(?![\w-])(.*)$/.exec(t)
  if (m) return `${doboz}${m[2]}`
  return `${doboz} ${t}`
}

export function keretCss(doboz = KESZLET_DOBOZ): Plugin {
  return {
    postcssPlugin: 'keszlet-keret-szukites',
    Once(root) {
      // A Tailwind @layer rétegei feloldva: a réteg nélküli keret-CSS (a portál stílusa) különben mindig
      // felülírná őket. A sorrend (alap → komponensek → segédosztályok) a fájlban ugyanaz marad.
      root.walkAtRules('layer', (at: AtRule) => {
        if (at.nodes && at.nodes.length) at.replaceWith(at.nodes)
        else at.remove()
      })
      root.walkRules((rule: Rule) => {
        let p = rule.parent
        while (p && p.type === 'atrule') {
          if (/keyframes$/i.test((p as AtRule).name)) return
          p = p.parent
        }
        rule.selectors = rule.selectors.map((s) => szukitettSelektor(s, doboz))
      })
    },
  }
}

/** A kész stíluslap szűkítése (a fordítás végén, a Tailwind kimenetén). */
export const szukit = (css: string) => postcss([keretCss()]).process(css, { from: undefined }).css
