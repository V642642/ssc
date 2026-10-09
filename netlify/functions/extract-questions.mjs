import { callGemini, result } from './_gemini.mjs'

function isExamQuestion(question) {
  const text = String(question.question || '').toLowerCase()
  const metadata = /overview|test series|add new test|generate html|exam category|select exam|test title|mapping id|created from date|search clear|coming soon|paid status|all language/.test(text)
  const placeholders = (question.options || []).every((option, index) => option === `Option ${String.fromCharCode(65 + index)}`)
  return text.length >= 12 && !metadata && !placeholders && Array.isArray(question.options) && question.options.length >= 2
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return result(405, { error: 'POST required' })
  try {
    const { title, text, apiKey } = JSON.parse(event.body || '{}')
    const prompt = `Extract only real SSC CHSL multiple-choice exam questions from this PDF text. A real question must ask something to solve, identify, calculate, complete, choose, or interpret. NEVER return website/interface metadata such as OVERVIEW, Test series, Add New Test, Generate HTML, Exam Category, Test Title, Mapping ID, Created From Date, Search, Clear, Coming Soon, or Paid Status. Ignore headers, footers, navigation labels, dates, page numbers, and metadata. Copy the question and options exactly as printed. Preserve every literal character, including (P), (Q), (R), (S), brackets, punctuation, symbols, units, negative signs, degree signs, fractions, and mathematical operators. Do not rename option labels to A/B/C/D and do not merge or rewrite option text. Return only valid JSON: {"questions":[{"question":"string","options":["string","string","string","string"],"optionLabels":["P","Q","R","S"],"answer":null,"section":"General Intelligence|Quantitative Aptitude|English Language|General Awareness","explanation":null}]}. Use optionLabels only when labels are visibly printed; otherwise use ["A","B","C","D"]. Do not invent missing options or answers. If a page has no real question, omit it. Filename: ${title}\n\nPDF text:\n${String(text || '').slice(0, 120000)}`
    const data = await callGemini([{ parts: [{ text: prompt }] }], { generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }, apiKey)
    const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{"questions":[]}')
    const questions = (parsed.questions || []).map((question) => ({ ...question, id: crypto.randomUUID(), options: question.options?.slice(0, 4) || [], answer: question.answer ?? null })).filter(isExamQuestion)
    return result(200, { questions })
  } catch (error) {
    return result(500, { error: error.message })
  }
}
