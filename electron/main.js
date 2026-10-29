// Electron main process for the Készletfigyelő desktop build.
//
// A felületet egy saját, ÁLLANDÓ címről szolgáljuk ki (app://keszletfigyelo). Korábban minden
// indításkor véletlen porton futó helyi webszerverről jött; a böngészőmotor a helyi tárolót címenként
// (a porttal együtt) kezeli, így egy újraindítás után a korábbi adatokat nem látta. Az állandó cím
// mellett a tároló minden indításkor ugyanaz; a régi címek alatti adatok visszakereshetők
// (regiAdatok.js, csak olvasás).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { regiAdatokKeresese } = require('./regiAdatok.js')

const DIST_DIR = path.join(__dirname, 'dist')
const SCHEME = 'app'
const HOST = 'keszletfigyelo'

// A saját séma „rendes” webcímként viselkedik: van helyi tárolója, működik a fetch és a modul-szkript.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

const userDir = () => app.getPath('userData')
const beallitasFajl = () => path.join(userDir(), 'keszletfigyelo-beallitas.json')
const sorFajl = () => path.join(userDir(), 'mentesi-sor.json')
const elintezveFajl = () => path.join(userDir(), 'regi-adatok-elintezve')

/** Írás ideiglenes fájlba, majd átnevezés: félbeszakadt írás nem marad a helyén. */
function atomiIras(fajl, tartalom) {
  fs.mkdirSync(path.dirname(fajl), { recursive: true })
  const tmp = `${fajl}.${process.pid}.tmp`
  fs.writeFileSync(tmp, tartalom, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, fajl)
}

function beallitasOlvasas() {
  try {
    const b = JSON.parse(fs.readFileSync(beallitasFajl(), 'utf8'))
    return { supabaseUrl: typeof b.supabaseUrl === 'string' ? b.supabaseUrl : null, supabaseAnonKey: typeof b.supabaseAnonKey === 'string' ? b.supabaseAnonKey : null }
  } catch {
    return { supabaseUrl: null, supabaseAnonKey: null }
  }
}

let nemMentett = 0

ipcMain.on('keszlet:beallitas', (e) => {
  e.returnValue = beallitasOlvasas()
})
ipcMain.handle('keszlet:regi-adatok', () => regiAdatokKeresese(path.join(userDir(), 'Local Storage', 'leveldb')))
ipcMain.handle('keszlet:biztonsagi-mentes', (_e, nev, tartalom) => {
  const safe = String(nev).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  const fajl = path.join(userDir(), 'biztonsagi-mentesek', `${new Date().toISOString().replace(/[:.]/g, '-')}-${safe}.json`)
  atomiIras(fajl, String(tartalom))
  return fajl
})
ipcMain.handle('keszlet:regi-adatok-elintezve', () => atomiIras(elintezveFajl(), new Date().toISOString()))
ipcMain.on('keszlet:regi-adatok-elintezve-van', (e) => {
  e.returnValue = fs.existsSync(elintezveFajl())
})
ipcMain.on('keszlet:mentesi-sor-irasa', (_e, tartalom) => {
  try {
    atomiIras(sorFajl(), String(tartalom))
  } catch (hiba) {
    console.error('[asztali] a mentési sor fájlba írása nem sikerült', hiba)
  }
})
ipcMain.on('keszlet:mentesi-sor-olvasasa', (e) => {
  try {
    e.returnValue = fs.readFileSync(sorFajl(), 'utf8')
  } catch {
    e.returnValue = null
  }
})
ipcMain.on('keszlet:nem-mentett', (_e, darab) => {
  nemMentett = Number(darab) || 0
})

function kiszolgalas() {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url)
    if (url.host !== HOST) return new Response('Nem található', { status: 404 })
    const relative = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const filePath = path.join(DIST_DIR, relative)
    if (!filePath.startsWith(DIST_DIR + path.sep)) return new Response('Tiltott', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: 'Készletfigyelő',
    backgroundColor: '#f4f5f7',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadURL(`${SCHEME}://${HOST}/index.html`)

  // A felület bezáráskor jelzi, ha van nem mentett változás (beforeunload). Electronban ez
  // magától nem kérdez, csak csendben megakadályozná a bezárást: itt kérdezünk rá.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const valasz = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Maradok', 'Bezárom'],
      defaultId: 0,
      cancelId: 0,
      title: 'Nem mentett változások',
      message: nemMentett > 0 ? `${nemMentett} művelet még nem jutott el a szerverre.` : 'Van még nem mentett változás.',
      detail: 'Ha most bezárja, a változások a gépen megmaradnak, és a következő indításkor mentődnek. Ha biztosra akar menni, várja meg, amíg az internetkapcsolat helyreáll.',
    })
    if (valasz === 1) event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  kiszolgalas()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
