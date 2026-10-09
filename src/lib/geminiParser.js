const apiBase = import.meta.env.DEV ? 'http://localhost:8787/api' : '/.netlify/functions'
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function extractQuestionsWithGemini(text, title, apiKey, onProgress = () => {}, onBatch = () => {}) {
  const pages = text.split(/(?=PAGE \d+:)/).map((page) => page.trim()).filter(Boolean)
  const batches = []
  for (let index = 0; index < pages.length; index += 5) batches.push(pages.slice(index, index + 5).join('\n\n'))
  const resultsByBatch = []
  const pendingBatches = []
  let completed = 0
  let nextBatchToEmit = 0
  const extractBatch = async (batchIndex) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${apiBase}/extract-questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, text: batches[batchIndex], apiKey }) })
      const data = await response.json()
      if (response.ok) return Array.isArray(data.questions) ? data.questions : []
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(data.error || 'Gemini extraction failed')
      await wait(1500 * (attempt + 1))
    }
    return []
  }
  const publish = (batchIndex, questions) => {
    resultsByBatch[batchIndex] = questions
    pendingBatches[batchIndex] = questions
    while (pendingBatches[nextBatchToEmit]) {
      onBatch(pendingBatches[nextBatchToEmit], nextBatchToEmit)
      nextBatchToEmit += 1
    }
    completed += 1
    onProgress({ completed, total: batches.length })
  }
  const firstResults = await Promise.all(batches.slice(0, 2).map((_, index) => extractBatch(index)))
  firstResults.forEach((questions, index) => publish(index, questions))
  for (let batchIndex = 2; batchIndex < batches.length; batchIndex += 1) {
    await wait(1800)
    publish(batchIndex, await extractBatch(batchIndex))
  }
  const results = resultsByBatch.flat()
  const seen = new Set()
  return results.filter((question) => {
    const key = String(question.question || '').toLowerCase().replace(/\W/g, '').slice(0, 160)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function studyApiUrl(path) {
  const localPath = path === 'ask-ai' ? 'ask' : path
  return `${apiBase}/${localPath}`
}
