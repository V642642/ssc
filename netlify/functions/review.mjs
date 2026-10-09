import { callGemini, result } from './_gemini.mjs'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return result(405, { error: 'POST required' })
  try {
    const { questions = [], answers = {}, apiKey } = JSON.parse(event.body || '{}')
    const prompt = questions.map((question, index) => `${index + 1}. ${question.question}\nOptions: ${question.options.join(' | ')}\nSelected: ${question.options[answers[question.id]] || 'Not attempted'}\nCorrect: ${question.options[question.answer] || 'Not provided'}`).join('\n\n')
    const data = await callGemini([{ parts: [{ text: `Review this SSC CHSL attempt. Return a short score interpretation, two strengths, and three specific study actions. Do not predict future questions.\n\n${prompt}` }] }], { generationConfig: { temperature: 0.2 } }, apiKey)
    return result(200, { review: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'Gemini returned no review.' })
  } catch (error) {
    return result(500, { error: error.message })
  }
}
