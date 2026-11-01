/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** A többi program címe a hivatkozásokhoz (TERV.md F18); üresen a hivatkozás csak szöveg. */
  readonly VITE_KONYVELO_URL?: string
  readonly VITE_EAFA_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
