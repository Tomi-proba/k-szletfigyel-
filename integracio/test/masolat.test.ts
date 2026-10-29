import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "../esemenyek/src/index.ts";
import { fingerprints } from "../esemenyek/src/lenyomat.ts";

/**
 * A közös eseményformátum itt csak másolat (TERV.md F14.6). Ez a teszt jelzi, ha valaki helyben átírta:
 * a változtatás helye a forrásrepó (AWEBOLDAL packages/esemenyek), utána újra kell másolni (npm run masol).
 */
const read = (p: string) => readFileSync(new URL(`../esemenyek/${p}`, import.meta.url));
const forras = JSON.parse(read("FORRAS.json").toString("utf8")) as { commit: string; files: Record<string, string> };

describe("eseményformátum-másolat", () => {
  it("minden fájl változatlan a forráshoz képest, és nincs helyben hozzáadott fájl", () => {
    for (const [file, hash] of Object.entries(forras.files)) expect(createHash("sha256").update(read(file)).digest("hex"), file).toBe(hash);
    const local = readdirSync(new URL("../esemenyek/src", import.meta.url)).map((f) => `src/${f}`);
    expect(local.sort()).toEqual(Object.keys(forras.files).filter((f) => f.startsWith("src/")).sort());
  });

  it("a kiadott eseményverziók lenyomata egyezik a forrásban rögzítettel", () => {
    const stored = JSON.parse(read("formatum-lenyomat.json").toString("utf8")) as Record<string, string>;
    expect(fingerprints(EVENT_TYPES)).toEqual(stored);
  });
});
