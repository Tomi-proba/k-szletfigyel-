// Futási mód (AWEBOLDAL TERV.md F24 KS2): a Készlet önállóan (HashRouter: a Renderen és az asztali programban,
// mint eddig) vagy a közös keretben fut. A keretben az útvonalai a keret útválasztóján, a /keszlet előtag alatt
// vannak; önállóan minden pontosan a régi.

let utvonalElotag = ''

export function keretModBeallitas(utvonal: string) {
  utvonalElotag = utvonal.replace(/\/+$/, '')
}

export const keretben = () => utvonalElotag !== ''
export const alapUtvonal = () => utvonalElotag

/** Egy Készleten belüli abszolút útvonal (pl. /mozgasnaplo) a futási módnak megfelelően. */
export function ut(utvonal: string): string {
  if (!utvonalElotag || !utvonal.startsWith('/')) return utvonal
  if (utvonal === utvonalElotag || utvonal.startsWith(`${utvonalElotag}/`) || utvonal.startsWith(`${utvonalElotag}?`)) return utvonal
  if (utvonal === '/') return utvonalElotag
  if (utvonal.startsWith('/?') || utvonal.startsWith('/#')) return `${utvonalElotag}${utvonal.slice(1)}`
  return `${utvonalElotag}${utvonal}`
}

/** A keretbeli útvonalból a Készlet saját útvonala (pl. /keszlet/mozgasnaplo → /mozgasnaplo). */
export function sajatUtvonal(pathname: string): string {
  if (!utvonalElotag || !pathname.startsWith(utvonalElotag)) return pathname
  return pathname.slice(utvonalElotag.length) || '/'
}
