// A Készlet hivatkozásai a futási módnak megfelelő előtaggal (lásd futas.ts). Minden belső hivatkozás és
// navigálás ezen át megy; a tests/keretFutas.test.ts őrzi, hogy közvetlenül ne használjuk a react-router-dom-ét.
import { forwardRef, useCallback } from 'react'
import {
  Link as RLink,
  Navigate as RNavigate,
  useNavigate as rUseNavigate,
  type LinkProps,
  type NavigateOptions,
  type NavigateProps,
  type To,
} from 'react-router-dom'
import { ut } from './futas'

const elotag = (to: To): To => (typeof to === 'string' ? ut(to) : { ...to, pathname: to.pathname ? ut(to.pathname) : to.pathname })

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...p }, ref) {
  return <RLink ref={ref} to={elotag(to)} {...p} />
})

export function Navigate({ to, ...p }: NavigateProps) {
  return <RNavigate to={elotag(to)} {...p} />
}

export function useNavigate() {
  const n = rUseNavigate()
  return useCallback(
    (to: To | number, o?: NavigateOptions) => {
      if (typeof to === 'number') n(to)
      else n(elotag(to), o)
    },
    [n],
  )
}
