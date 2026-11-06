// Felhasználókezelés egy helyen (TERV.md F25): a modulok szerepkörei a portálon. A portál a tagonkénti
// modulszerepet tárolja; ha nincs megadva, a portál-szerepből jön az alapértelmezés. A modulok a portál
// jegyében és tagság-jelzésében a HATÁLYOS szerepet kapják (null = nincs hozzáférés).
import type { ModulKod } from '@aweboldal/arak'

export type PortalSzerep = 'tulajdonos' | 'konyvelo' | 'munkatars'

export interface ModulSzerepLeiras {
  /** A modul saját szerepkódja (így megy a jegyben). */
  kod: string
  cim: string
  /** A modul adminisztrátori szerepe: ebből mindig maradnia kell legalább egynek. */
  admin?: boolean
}

/** Kifejezetten „nincs hozzáférés” (pl. a portál-könyvelő ne lássa a Készletet). */
export const NINCS_HOZZAFERES = 'nincs'

export const MODUL_SZEREPEK: Record<ModulKod, readonly ModulSzerepLeiras[]> = {
  konyvelo: [
    { kod: 'ADMIN', cim: 'Adminisztrátor', admin: true },
    { kod: 'CHIEF_ACCOUNTANT', cim: 'Vezető könyvelő' },
    { kod: 'ACCOUNTANT', cim: 'Könyvelő' },
    { kod: 'VIEWER', cim: 'Megtekintő' },
  ],
  keszlet: [
    { kod: 'fo_iroda', cim: 'Fő iroda', admin: true },
    { kod: 'iroda', cim: 'Iroda' },
    { kod: 'raktaros', cim: 'Raktáros' },
    { kod: 'tulajdonos', cim: 'Tulajdonos (csak lát)' },
  ],
  afa: [
    { kod: 'ADMIN', cim: 'Adminisztrátor', admin: true },
    { kod: 'ACCOUNTANT', cim: 'Könyvelő' },
    { kod: 'APPROVER', cim: 'Jóváhagyó' },
    { kod: 'TAXPAYER', cim: 'Adózó (csak lát)' },
  ],
}

/** Érvényes kifejezett modulszerep-e (a szerepkód vagy a „nincs”). */
export function ervenyesModulSzerep(modul: ModulKod, kod: string): boolean {
  return kod === NINCS_HOZZAFERES || MODUL_SZEREPEK[modul].some((s) => s.kod === kod)
}

export function adminSzerep(modul: ModulKod): string {
  return MODUL_SZEREPEK[modul].find((s) => s.admin)!.kod
}

/**
 * Alapértelmezés, ha a portálon nincs modulszerep megadva: a tulajdonos a modul adminisztrátora, a
 * portál-könyvelő „könyvelő” (a Könyvelőben nem vezető könyvelő: az lezárhat időszakot és szerkesztheti a
 * számlatükröt; arra a portálon kell emelni), a munkatárs modulszerep nélkül nem kap hozzáférést.
 */
export function alapModulSzerep(portalSzerep: PortalSzerep, modul: ModulKod): string | null {
  if (portalSzerep === 'tulajdonos') return adminSzerep(modul)
  if (portalSzerep === 'konyvelo') return modul === 'keszlet' ? 'iroda' : 'ACCOUNTANT'
  return null
}

/** A hatályos modulszerep: a kifejezett (a „nincs” = null), különben az alapértelmezés. */
export function hatalyosModulSzerep(portalSzerep: PortalSzerep, modul: ModulKod, kifejezett: string | null | undefined): string | null {
  if (kifejezett === NINCS_HOZZAFERES) return null
  if (kifejezett) return kifejezett
  return alapModulSzerep(portalSzerep, modul)
}

export function modulSzerepCim(modul: ModulKod, kod: string | null): string {
  if (!kod) return 'Nincs hozzáférés'
  return MODUL_SZEREPEK[modul].find((s) => s.kod === kod)?.cim ?? kod
}
