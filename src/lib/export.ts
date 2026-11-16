// Generic table export to .xlsx (ExcelJS) and .pdf (jsPDF + autotable).
// Callers assemble plain row objects from already-computed view data, so
// this module has no dependency on the store or business rules.
// ExcelJS/jsPDF and the embedded font are only pulled in when an export is
// actually triggered, keeping them out of the app's initial bundle.
import type { jsPDF as JsPDFType } from 'jspdf'

export interface ExportColumn<T> {
  header: string
  accessor: (row: T) => string | number
  /** Column width in Excel "character" units. */
  width?: number
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportToExcel<T>(filename: string, sheetName: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Készletkezelő'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.header, width: c.width ?? 18 }))

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }

  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((c) => [c.header, c.accessor(row)])))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  )
}

async function registerHungarianFont(doc: JsPDFType) {
  // jsPDF's built-in core fonts only cover WinAnsi encoding, which is
  // missing the Hungarian ő/ű glyphs - embed a real Unicode font instead.
  const { NOTO_SANS_BOLD_BASE64, NOTO_SANS_REGULAR_BASE64 } = await import('./fonts/notoSans')
  doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_BASE64)
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
  doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_BASE64)
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
  doc.setFont('NotoSans', 'normal')
}

export async function exportToPdf<T>(filename: string, title: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const orientation = columns.length > 5 ? 'landscape' : 'portrait'
  // Sok oszlopnál (pl. Mozgásnapló) A3 fekvő lap, kisebb betű és az oszlopszélességek aránya a megadott
  // szélességek szerint – különben a szavak betűnként törnének.
  const szeles = columns.length > 12
  const doc = new jsPDF({ orientation, unit: 'mm', format: szeles ? 'a3' : 'a4' })
  await registerHungarianFont(doc)

  doc.setFontSize(14)
  doc.setFont('NotoSans', 'bold')
  doc.text(title, 14, 15)
  doc.setFont('NotoSans', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(107, 114, 128)
  doc.text(`Exportálva: ${new Date().toLocaleString('hu-HU')}`, 14, 21)
  doc.setTextColor(0, 0, 0)

  autoTable(doc, {
    startY: 26,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(c.accessor(row)))),
    styles: { font: 'NotoSans', fontSize: szeles ? 7 : 8, cellPadding: szeles ? 1.5 : 2 },
    columnStyles: oszlopSzelessegek(columns.map((c) => c.width ?? 18), doc.internal.pageSize.getWidth() - 29),
    headStyles: { font: 'NotoSans', fontStyle: 'bold', fillColor: [29, 78, 216], textColor: 255 },
    alternateRowStyles: { fillColor: [244, 245, 247] },
  })

  doc.save(filename)
}

/** A megadott (Excel-) szélességek arányában osztja szét a lap hasznos szélességét (mm). */
export function oszlopSzelessegek(szelessegek: number[], hasznos: number): Record<number, { cellWidth: number }> {
  const osszes = szelessegek.reduce((a, b) => a + b, 0) || 1
  return Object.fromEntries(szelessegek.map((w, i) => [i, { cellWidth: (w / osszes) * hasznos }]))
}
