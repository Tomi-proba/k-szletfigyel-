// A Chromium (és így az Electron) helyi tárolójának (localStorage) olvasása közvetlenül a lemezről.
//
// Miért kell: a korábbi asztali változat minden indításkor véletlen porton szolgálta ki a felületet, a
// böngészőmotor pedig a tárolót címenként (a porttal együtt) kezeli. A régi adatok így ott maradtak a
// lemezen, de a program nem látta őket. Ez a modul csak OLVAS (semmit nem ír és nem töröl), és a régi
// címek alatti Készlet-adatokat adja vissza, hogy a felhasználó visszatölthesse őket.
//
// A formátum: LevelDB (a .log fájlok írási naplók, az .ldb fájlok rendezett, Snappy-val tömörített
// táblák). A kulcs: "_" + cím + "\x00" + kódolt kulcs; az érték egy kódolásjelző bájt (0: UTF-16LE,
// 1: Latin-1) után a szöveg. A "META:" + cím kulcs a cím utolsó módosításának idejét tartalmazza.
'use strict'

const fs = require('fs')
const path = require('path')

// ---------- Snappy (blokkformátum) ----------

function readVarint(buf, pos) {
  let result = 0
  let shift = 0
  for (;;) {
    if (pos >= buf.length) throw new Error('Csonka varint')
    const b = buf[pos++]
    result += (b & 0x7f) * 2 ** shift
    if (b < 0x80) return [result, pos]
    shift += 7
    if (shift > 63) throw new Error('Hibás varint')
  }
}

function snappyDecompress(src) {
  let [length, pos] = readVarint(src, 0)
  const out = Buffer.alloc(length)
  let op = 0
  while (pos < src.length) {
    const tag = src[pos++]
    const kind = tag & 3
    if (kind === 0) {
      let len = tag >> 2
      if (len >= 60) {
        const bytes = len - 59
        len = 0
        for (let i = 0; i < bytes; i++) len |= src[pos + i] << (8 * i)
        pos += bytes
      }
      len += 1
      src.copy(out, op, pos, pos + len)
      pos += len
      op += len
      continue
    }
    let len
    let offset
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4
      offset = ((tag >> 5) << 8) | src[pos++]
    } else if (kind === 2) {
      len = (tag >> 2) + 1
      offset = src.readUInt16LE(pos)
      pos += 2
    } else {
      len = (tag >> 2) + 1
      offset = src.readUInt32LE(pos)
      pos += 4
    }
    if (offset === 0 || offset > op) throw new Error('Hibás Snappy-hivatkozás')
    for (let i = 0; i < len; i++) out[op + i] = out[op - offset + i]
    op += len
  }
  if (op !== length) throw new Error('Hibás Snappy-hossz')
  return out
}

// ---------- Táblák (.ldb) ----------

function blockEntries(block) {
  const numRestarts = block.readUInt32LE(block.length - 4)
  const end = block.length - 4 - numRestarts * 4
  const entries = []
  let pos = 0
  let lastKey = Buffer.alloc(0)
  while (pos < end) {
    let shared, nonShared, valueLen
    ;[shared, pos] = readVarint(block, pos)
    ;[nonShared, pos] = readVarint(block, pos)
    ;[valueLen, pos] = readVarint(block, pos)
    const key = Buffer.concat([lastKey.subarray(0, shared), block.subarray(pos, pos + nonShared)])
    pos += nonShared
    const value = block.subarray(pos, pos + valueLen)
    pos += valueLen
    entries.push([key, value])
    lastKey = key
  }
  return entries
}

function readBlock(file, offset, size) {
  const raw = file.subarray(offset, offset + size)
  const type = file[offset + size]
  if (type === 0) return raw
  if (type === 1) return snappyDecompress(raw)
  throw new Error(`Ismeretlen tömörítés: ${type}`)
}

function readTable(file, emit) {
  if (file.length < 48) return
  const footer = file.subarray(file.length - 48)
  let pos = 0
  let off, size
  ;[off, pos] = readVarint(footer, pos) // metaindex
  ;[size, pos] = readVarint(footer, pos)
  ;[off, pos] = readVarint(footer, pos) // index
  ;[size, pos] = readVarint(footer, pos)
  for (const [, handle] of blockEntries(readBlock(file, off, size))) {
    let [bOff, p] = readVarint(handle, 0)
    const [bSize] = readVarint(handle, p)
    for (const [ikey, value] of blockEntries(readBlock(file, bOff, bSize))) {
      if (ikey.length < 8) continue
      const trailer = ikey.readBigUInt64LE(ikey.length - 8)
      emit(ikey.subarray(0, ikey.length - 8), Number(trailer >> 8n), Number(trailer & 0xffn), value)
    }
  }
}

// ---------- Írási napló (.log) ----------

function readLog(file, emit) {
  const BLOCK = 32768
  let pos = 0
  let pending = []
  while (pos + 7 <= file.length) {
    const left = BLOCK - (pos % BLOCK)
    if (left < 7) {
      pos += left
      continue
    }
    const len = file.readUInt16LE(pos + 4)
    const type = file[pos + 6]
    const data = file.subarray(pos + 7, pos + 7 + len)
    pos += 7 + len
    if (type === 0 && len === 0) continue
    if (type === 1) applyBatch(data, emit)
    else if (type === 2) pending = [data]
    else if (type === 3) pending.push(data)
    else if (type === 4) {
      pending.push(data)
      applyBatch(Buffer.concat(pending), emit)
      pending = []
    }
  }
}

function applyBatch(batch, emit) {
  if (batch.length < 12) return
  let seq = Number(batch.readBigUInt64LE(0))
  const count = batch.readUInt32LE(8)
  let pos = 12
  for (let i = 0; i < count && pos < batch.length; i++) {
    const type = batch[pos++]
    let keyLen
    ;[keyLen, pos] = readVarint(batch, pos)
    const key = batch.subarray(pos, pos + keyLen)
    pos += keyLen
    let value = Buffer.alloc(0)
    if (type === 1) {
      let valueLen
      ;[valueLen, pos] = readVarint(batch, pos)
      value = batch.subarray(pos, pos + valueLen)
      pos += valueLen
    }
    emit(key, seq++, type, value)
  }
}

// ---------- A tároló értelmezése ----------

/** Az adatbázis legfrissebb állapota: kulcs → érték (a törölt kulcsok nélkül). */
function readLevelDb(dir) {
  const latest = new Map()
  const emit = (key, seq, type, value) => {
    const k = key.toString('latin1')
    const prev = latest.get(k)
    if (!prev || prev.seq < seq) latest.set(k, { seq, type, value: Buffer.from(value) })
  }
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return new Map()
  }
  for (const name of names.sort()) {
    const full = path.join(dir, name)
    try {
      if (name.endsWith('.ldb') || name.endsWith('.sst')) readTable(fs.readFileSync(full), emit)
      else if (name.endsWith('.log')) readLog(fs.readFileSync(full), emit)
    } catch {
      // Egy sérült fájl miatt nem adjuk fel: a többi fájl adata még visszanyerhető.
    }
  }
  const out = new Map()
  for (const [k, e] of latest) if (e.type === 1) out.set(Buffer.from(k, 'latin1'), e.value)
  return out
}

function decodeString(buf) {
  if (buf.length === 0) return ''
  if (buf[0] === 0) return buf.subarray(1).toString('utf16le')
  if (buf[0] === 1) return buf.subarray(1).toString('latin1')
  return buf.toString('utf8')
}

function lastModifiedFromMeta(buf) {
  // protobuf: 1: int64 last_modified (mikroszekundum 1601 óta), 2: uint64 size_bytes
  try {
    let pos = 0
    while (pos < buf.length) {
      let tag
      ;[tag, pos] = readVarint(buf, pos)
      if ((tag & 7) !== 0) return null
      let v
      ;[v, pos] = readVarint(buf, pos)
      if (tag >> 3 === 1) return new Date(v / 1000 - 11644473600000)
    }
  } catch {
    return null
  }
  return null
}

/** Címenként a localStorage tartalma: Map(cím → { adatok: Map(kulcs → szöveg), modositva: Date|null }). */
function readLocalStorage(dir) {
  const origins = new Map()
  const get = (origin) => {
    if (!origins.has(origin)) origins.set(origin, { adatok: new Map(), modositva: null })
    return origins.get(origin)
  }
  for (const [key, value] of readLevelDb(dir)) {
    if (key[0] === 0x5f) {
      const sep = key.indexOf(0)
      if (sep < 0) continue
      const origin = key.subarray(1, sep).toString('latin1')
      get(origin).adatok.set(decodeString(key.subarray(sep + 1)), decodeString(value))
    } else if (key.subarray(0, 5).toString('latin1') === 'META:') {
      get(key.subarray(5).toString('latin1')).modositva = lastModifiedFromMeta(value)
    }
  }
  return origins
}

module.exports = { readLevelDb, readLocalStorage, snappyDecompress }
