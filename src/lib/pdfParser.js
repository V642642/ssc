import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export async function extractPdfText(file) {
  const bytes = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').replace(/[ \t]+\n/g, '\n')
    pages.push(`PAGE ${pageNumber}:\n${pageText}`)
  }
  return pages.join('\n')
}

export function questionFromText(text, title) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const prompt = lines.slice(0, 4).join(' ').slice(0, 420)
  return {
    id: crypto.randomUUID(),
    question: prompt || 'Imported question. Add answer options before attempting it.',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    answer: null,
    explanation: `Imported from ${title}. Review the source paper while adding the correct answer.`,
    section: 'General Intelligence',
  }
}
