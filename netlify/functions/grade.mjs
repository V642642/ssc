import { callGemini, result } from './_gemini.mjs'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return result(405, { error: 'POST required' })
  try {
    const { questions = [], answers = {}, apiKey } = JSON.parse(event.body || '{}')
    const prompt = `Grade this SSC CHSL attempt. Determine the correct option index for every question, using zero-based indexes. Return only JSON: {"grades":[{"id":"question id","correctIndex":0,"explanation":"short solution"}]}. Never guess when a question is incomplete; use null for correctIndex.\n\n${questions.map((question) => `ID: ${question.id}\nQuestion: ${question.question}\nOptions: ${question.options.map((option, index) => `${index}: ${option}`).join(' | ')}\nSelected index: ${answers[question.id] ?? 'not attempted'}`).join('\n\n')}`
    const data = await callGemini([{ parts: [{ text: prompt }] }], { generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }, apiKey)
    const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{"grades":[]}')
    return result(200, { grades: parsed.grades || [] })
  } catch (error) {
    return result(500, { error: error.message })
  }
}
