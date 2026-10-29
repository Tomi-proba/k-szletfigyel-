// Az asztali program és a felület közti szűk, kifejezett felület (contextBridge). A felület semmilyen
// más Node- vagy Electron-funkciót nem ér el.
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('keszletAsztali', {
  /** A beállítófájl tartalma (pl. a szerver címe), az indításkor egyszer. */
  beallitas: ipcRenderer.sendSync('keszlet:beallitas'),
  /** A korábbi (véletlen portos) indítások adatai. */
  regiAdatok: () => ipcRenderer.invoke('keszlet:regi-adatok'),
  /** Biztonsági mentés fájlba (a felhasználó mappájába); visszaadja a fájl helyét. */
  biztonsagiMentes: (nev, tartalom) => ipcRenderer.invoke('keszlet:biztonsagi-mentes', nev, tartalom),
  /** A „ne kérdezze többet” jelzés a régi adatokra. */
  regiAdatokElintezve: () => ipcRenderer.invoke('keszlet:regi-adatok-elintezve'),
  regiAdatokElintezveVan: ipcRenderer.sendSync('keszlet:regi-adatok-elintezve-van'),
  /** A nem mentett változások sorának másolata fájlba, és visszaolvasása. */
  mentesiSorFajlba: (tartalom) => ipcRenderer.send('keszlet:mentesi-sor-irasa', tartalom),
  mentesiSorFajlbol: () => ipcRenderer.sendSync('keszlet:mentesi-sor-olvasasa'),
  /** Hány nem mentett változás vár (a bezáráskori kérdéshez). */
  nemMentett: (darab) => ipcRenderer.send('keszlet:nem-mentett', darab),
})
