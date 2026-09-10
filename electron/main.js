// Electron main process for the Készletfigyelő desktop build.
// Serves the pre-built Vite output (./dist) from a tiny local HTTP server
// instead of loading it via file:// - Chromium blocks module scripts and
// stylesheets loaded from file:// with CORS errors, so a local server
// sidesteps that entirely and behaves exactly like the hosted web version.
const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')

const DIST_DIR = path.join(__dirname, 'dist')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
      const filePath = path.join(DIST_DIR, relative)

      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403)
        res.end()
        return
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not found')
          return
        }
        const ext = path.extname(filePath)
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
        res.end(data)
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

let mainWindow

async function createWindow() {
  const port = await startServer()

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
    },
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
