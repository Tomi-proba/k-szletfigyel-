// Valódi Chromium-tároló előállítása tesztadatnak: két különböző porton (mint az asztali program két indítása).
const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs')
const out = process.argv[2]
async function serveOnce(fn) {
  const server = http.createServer((q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>ok</body></html>'))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try { await fn(port) } finally { server.close() }
  return port
}
;(async () => {
  fs.rmSync(out, { recursive: true, force: true })
  const ports = []
  // 1. indítás: sok adat (hogy a LevelDB tömörítve .ldb fájlba is írjon), majd 2. indítás: kevés, frissebb.
  for (const [i, size] of [[1, 3000], [2, 5]]) {
    const ctx = await chromium.launchPersistentContext(out, { headless: true })
    const page = await ctx.newPage()
    ports.push(await serveOnce(async (port) => {
      await page.goto(`http://127.0.0.1:${port}/`)
      await page.evaluate(([i, size]) => {
        const products = Array.from({ length: size }, (_, n) => ({ id: `p${i}-${n}`, name: `Termék ${n} – ékezet ŐŰ`, currentStock: n }))
        localStorage.setItem('keszletfigyelo-storage', JSON.stringify({ state: { products, movements: [], inditas: i }, version: 1 }))
        localStorage.setItem('keszletfigyelo-mentesi-sor', JSON.stringify({ tetelek: [{ id: `sor-${i}` }] }))
        localStorage.setItem('mas-kulcs', 'x')
        if (i === 1) { localStorage.setItem('torolt', 'y'); localStorage.removeItem('torolt') }
      }, [i, size])
    }))
    await ctx.close()
  }
  fs.writeFileSync(out + '.ports.json', JSON.stringify(ports))
  console.log('kész', ports)
})()
