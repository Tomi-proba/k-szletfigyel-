// Közös belépés (TERV.md F21): a portál rövid életű, egyszer használható BELÉPÉSI JEGYET ad a moduloknak,
// és KILÉPÉSI JEGGYEL jelzi, ha a felhasználó kijelentkezett. Mindkettő ES256-tal aláírt JWT; a modulok a
// portál nyilvános kulcsaival (JWKS) ellenőrzik. Titkos kulcs nem megy át a modulokhoz.
//
// A belépési jegyet a portál csak kétlépcsős azonosítás után adja ki, és a modul is csak `aal: "aal2"`
// jegyet fogad el: egy belépés után sem lehet kétlépcsős azonosítás nélkül egyik modulba se bejutni.
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

export const JEGY_MODULOK = ["konyvelo", "afa", "keszlet"] as const;
export type JegyModul = (typeof JEGY_MODULOK)[number];

/** A jegy címzettje: egy jegy csak egy modulnak szól. */
export const belepesiCimzett = (modul: JegyModul) => `eafa-csomag:modul:${modul}`;
export const kilepesiCimzett = (modul: JegyModul) => `eafa-csomag:kilepes:${modul}`;
/** A tagság-jelzés címzettje (F25): a portálon változott a felhasználó hozzáférése a modulhoz. */
export const tagsagCimzett = (modul: JegyModul) => `eafa-csomag:tagsag:${modul}`;

/**
 * A portál kérésének címzettje (F27 K): a portál a háttérben, szerverről szerverre kéri a modult a programok
 * összekapcsolására (kapcsolódási kód a központhoz, a NAV-hozzáférés kódja vagy beváltása). Felhasználó nem
 * másol kódot: a portál aláírása bizonyítja, hogy a kérés a cég portál-párjáról szól.
 */
export const keresCimzett = (modul: JegyModul) => `eafa-csomag:keres:${modul}`;

/** A belépési jegy élettartama (másodperc): csak az átadásra elég. */
export const BELEPESI_JEGY_MP = 120;
export const KILEPESI_JEGY_MP = 300;
export const TAGSAG_JELZES_MP = 300;
export const PORTAL_KERES_MP = 60;
/** Megengedett óraeltérés az ellenőrzéskor (másodperc). */
export const ORA_TURES_MP = 30;

/** Alapértelmezett és legnagyobb tétlenségi idő (perc). A raktáros szerepkörnél a cég adminisztrátora a
 * portálon hosszabbra állíthatja (legfeljebb 12 óra); a kétlépcsős azonosítás ettől mindig kötelező. */
export const TETLENSEG_ALAP_PERC = 30;
export const TETLENSEG_MAX_PERC = 12 * 60;

export const belepesiJegySchema = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  jti: z.string().min(8),
  sid: z.string().min(8),
  email: z.string().email(),
  name: z.string(),
  aal: z.literal("aal2"),
  exp: z.number(),
  iat: z.number(),
  tetlenseg_perc: z.number().int().min(1).max(TETLENSEG_MAX_PERC),
  ceg: z.object({
    id: z.string().uuid(),
    nev: z.string(),
    szerep: z.enum(["tulajdonos", "konyvelo", "munkatars"]),
    /** A felhasználó modulbeli szerepköre, ha a portálon meg van adva (pl. Készletkezelő „raktaros”). */
    modulSzerep: z.string().nullable(),
    /** Kiegészítő jogok a szerepkör mellé (F26: eÁFA „APPROVER” = második jóváhagyó). */
    modulJogok: z.array(z.string()).default([]),
    /** Lemondott modul vagy lejárt próba: csak olvasható. */
    csakOlvashato: z.boolean(),
    /** A cég adószáma (F26a: az eÁFA az ügyfél-adózót ehhez rendeli; hozzáférést NEM ad, D13). */
    adoszam: z.string().optional(),
    /** Ha a cég egy könyvelőiroda ügyfele: a kezelő iroda (F26a). */
    iroda: z.object({ id: z.string().uuid(), nev: z.string() }).nullable().default(null),
    /**
     * Ügyfélcégnél: a felhasználó az iroda munkatársa (a hozzárendelésből) vagy az ügyfél saját embere (F26a). Az
     * eÁFA ebből tudja, hogy az ügyfél embere csak a saját adózóját láthatja, az iroda többi ügyfelét nem.
     */
    forras: z.enum(["sajat", "iroda"]).default("sajat"),
  }),
});
export type BelepesiJegy = z.infer<typeof belepesiJegySchema>;

export const kilepesiJegySchema = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  jti: z.string().min(8),
  sid: z.string().min(8),
  esemeny: z.literal("kilepes"),
  exp: z.number(),
  iat: z.number(),
});
export type KilepesiJegy = z.infer<typeof kilepesiJegySchema>;

/**
 * Tagság-jelzés (F25): a portál a meghívás elfogadása, a szerepváltás és az eltávolítás után minden érintett
 * modulnak elküldi a felhasználó HATÁLYOS modulszerepét a cégben (null = nincs hozzáférés: a modul törli a
 * tagságot és a munkameneteit). A jelzés mindig a küldéskori állapotot viszi, így a sorrend nem számít; ha nem
 * jut el, a modul a következő belépéskor a belépési jegyből igazodik.
 */
export const tagsagJelzesSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  jti: z.string().min(8),
  esemeny: z.literal("tagsag"),
  email: z.string().email(),
  name: z.string(),
  exp: z.number(),
  iat: z.number(),
  ceg: z.object({ id: z.string().uuid(), nev: z.string(), iroda: z.object({ id: z.string().uuid(), nev: z.string() }).nullable().default(null) }),
  modulSzerep: z.string().nullable(),
  modulJogok: z.array(z.string()).default([]),
});
export type TagsagJelzes = z.infer<typeof tagsagJelzesSchema>;

/**
 * Tagsági kivonat (F26): a felhasználó összes portál-cégében a modulbeli hatályos szerepe, egyszerre. Akkor
 * kéri a modul (szerverről, a felhasználó saját tokenjével), ha a portál nélkül, önállóan lépnek be: így a
 * szerep belépéskor is a portálhoz igazodik, és amelyik cégből a felhasználót a portálon eltávolították, ott a
 * portálról kapott tagság megszűnik.
 */
export const tagsagKivonatSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  jti: z.string().min(8),
  esemeny: z.literal("kivonat"),
  email: z.string().email(),
  exp: z.number(),
  iat: z.number(),
  cegek: z.array(z.object({ id: z.string().uuid(), modulSzerep: z.string().nullable(), modulJogok: z.array(z.string()).default([]) })),
});
export type TagsagKivonat = z.infer<typeof tagsagKivonatSchema>;

/** A portál kérései (F27 K). */
export const PORTAL_KERES_FELADATOK = [
  /** Kapcsolódási kód a központhoz (a modul a saját, a portál cégéhez rendelt cégére). */
  "kozpont-kod",
  /** eÁFA: kapcsolódási kód a Könyvelő NAV-hozzáféréséhez. */
  "nav-kod",
  /** Könyvelő: a NAV-hozzáférés állapota; `kod`-dal: összekapcsolás az eÁFA kódjával. */
  "nav-kapcsolas",
] as const;
export type PortalKeresFeladat = (typeof PORTAL_KERES_FELADATOK)[number];

export const portalKeresSchema = z.object({
  iss: z.string(),
  jti: z.string().min(8),
  esemeny: z.literal("kapcsolat"),
  feladat: z.enum(PORTAL_KERES_FELADATOK),
  exp: z.number(),
  iat: z.number(),
  ceg: z.object({ id: z.string().uuid(), nev: z.string(), adoszam: z.string() }),
  /** A Könyvelő NAV-összekapcsolásához: az eÁFA kódja. */
  kod: z.string().max(60).optional(),
});
export type PortalKeres = z.infer<typeof portalKeresSchema>;

export class JegyHiba extends Error {
  constructor(
    readonly kod: "ervenytelen" | "lejart" | "nem-ketlepcsos" | "mar-felhasznalt" | "rossz-cimzett",
    uzenet: string,
  ) {
    super(uzenet);
  }
}

async function ellenoriz(jegy: string, kulcsok: JWTVerifyGetKey, kiado: string, cimzett: string, maxElet: number) {
  try {
    const { payload } = await jwtVerify(jegy, kulcsok, {
      issuer: kiado,
      audience: cimzett,
      algorithms: ["ES256"],
      clockTolerance: ORA_TURES_MP,
      maxTokenAge: maxElet + ORA_TURES_MP,
    });
    return payload;
  } catch (e) {
    const kod = (e as { code?: string }).code;
    if (kod === "ERR_JWT_EXPIRED") throw new JegyHiba("lejart", "A belépési jegy lejárt. Lépj be újra a portálon.");
    if (kod === "ERR_JWT_CLAIM_VALIDATION_FAILED" && (e as { claim?: string }).claim === "aud")
      throw new JegyHiba("rossz-cimzett", "Ez a jegy nem ennek a modulnak szól.");
    throw new JegyHiba("ervenytelen", "Érvénytelen belépési jegy.");
  }
}

/**
 * Belépési jegy ellenőrzése a modulban: aláírás (a portál JWKS-e), kiadó, címzett (csak ez a modul),
 * lejárat, kétlépcsős azonosítás. Az egyszeri felhasználást (jti) a modul a saját táblájában jegyzi:
 * `felhasznal(jti, lejarat)` igazat ad, ha most használták először.
 */
export async function belepesiJegyEllenorzes(
  jegy: string,
  opts: { kulcsok: JWTVerifyGetKey; kiado: string; modul: JegyModul; felhasznal: (jti: string, lejar: Date) => Promise<boolean> },
): Promise<BelepesiJegy> {
  const payload = await ellenoriz(jegy, opts.kulcsok, opts.kiado, belepesiCimzett(opts.modul), BELEPESI_JEGY_MP);
  if (payload.aal !== "aal2") throw new JegyHiba("nem-ketlepcsos", "A belépéshez kétlépcsős azonosítás szükséges.");
  const r = belepesiJegySchema.safeParse(payload);
  if (!r.success) throw new JegyHiba("ervenytelen", "Érvénytelen belépési jegy.");
  if (!(await opts.felhasznal(r.data.jti, new Date(r.data.exp * 1000)))) throw new JegyHiba("mar-felhasznalt", "Ezt a belépési jegyet már felhasználták.");
  return r.data;
}

export async function kilepesiJegyEllenorzes(
  jegy: string,
  opts: { kulcsok: JWTVerifyGetKey; kiado: string; modul: JegyModul; felhasznal: (jti: string, lejar: Date) => Promise<boolean> },
): Promise<KilepesiJegy> {
  const payload = await ellenoriz(jegy, opts.kulcsok, opts.kiado, kilepesiCimzett(opts.modul), KILEPESI_JEGY_MP);
  const r = kilepesiJegySchema.safeParse(payload);
  if (!r.success) throw new JegyHiba("ervenytelen", "Érvénytelen kilépési jegy.");
  if (!(await opts.felhasznal(r.data.jti, new Date(r.data.exp * 1000)))) throw new JegyHiba("mar-felhasznalt", "Ezt a kilépési jegyet már felhasználták.");
  return r.data;
}

export async function tagsagJelzesEllenorzes(
  jegy: string,
  opts: { kulcsok: JWTVerifyGetKey; kiado: string; modul: JegyModul; felhasznal: (jti: string, lejar: Date) => Promise<boolean> },
): Promise<TagsagJelzes> {
  const payload = await ellenoriz(jegy, opts.kulcsok, opts.kiado, tagsagCimzett(opts.modul), TAGSAG_JELZES_MP);
  const r = tagsagJelzesSchema.safeParse(payload);
  if (!r.success) throw new JegyHiba("ervenytelen", "Érvénytelen tagság-jelzés.");
  if (!(await opts.felhasznal(r.data.jti, new Date(r.data.exp * 1000)))) throw new JegyHiba("mar-felhasznalt", "Ezt a tagság-jelzést már felhasználták.");
  return r.data;
}

export async function tagsagKivonatEllenorzes(
  jegy: string,
  opts: { kulcsok: JWTVerifyGetKey; kiado: string; modul: JegyModul; felhasznal: (jti: string, lejar: Date) => Promise<boolean> },
): Promise<TagsagKivonat> {
  const payload = await ellenoriz(jegy, opts.kulcsok, opts.kiado, tagsagCimzett(opts.modul), TAGSAG_JELZES_MP);
  const r = tagsagKivonatSchema.safeParse(payload);
  if (!r.success) throw new JegyHiba("ervenytelen", "Érvénytelen tagsági kivonat.");
  if (!(await opts.felhasznal(r.data.jti, new Date(r.data.exp * 1000)))) throw new JegyHiba("mar-felhasznalt", "Ezt a kivonatot már felhasználták.");
  return r.data;
}

/** A portál kérésének ellenőrzése a modulban (F27 K): aláírás, kiadó, címzett, lejárat, egyszeri felhasználás. */
export async function portalKeresEllenorzes(
  jegy: string,
  opts: { kulcsok: JWTVerifyGetKey; kiado: string; modul: JegyModul; felhasznal: (jti: string, lejar: Date) => Promise<boolean> },
): Promise<PortalKeres> {
  const payload = await ellenoriz(jegy, opts.kulcsok, opts.kiado, keresCimzett(opts.modul), PORTAL_KERES_MP);
  const r = portalKeresSchema.safeParse(payload);
  if (!r.success) throw new JegyHiba("ervenytelen", "Érvénytelen portál-kérés.");
  if (!(await opts.felhasznal(r.data.jti, new Date(r.data.exp * 1000)))) throw new JegyHiba("mar-felhasznalt", "Ezt a kérést már felhasználták.");
  return r.data;
}

/** A jegy a modul /sso oldalára az URL `#` utáni részében utazik (nem kerül a szervernaplókba). */
export const JEGY_FRAGMENT_KULCS = "jegy";
