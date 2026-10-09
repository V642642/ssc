import { createServer } from 'node:http'

const port = 8787
const apiKey = process.env.OPEN_AI_API_KEY
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'

function isExamQuestion(question) {
  const text = String(question.question || '').toLowerCase()
  const metadata = /overview|test series|add new test|generate html|exam category|select exam|test title|mapping id|created from date|search clear|coming soon|paid status|all language/.test(text)
  const placeholders = (question.options || []).every((option, index) => option === `Option ${String.fromCharCode(65 + index)}`)
  return text.length >= 12 && !metadata && !placeholders && Array.isArray(question.options) && question.options.length >= 2
}


function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://localhost:5173' })
  response.end(JSON.stringify(body))
}

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Headers': 'Content-Type' })
    response.end()
    return
  }
  if (request.method !== 'POST' || !['/api/review', '/api/ask', '/api/grade', '/api/extract-questions'].includes(request.url)) {
    send(response, 404, { error: 'Not found' })
    return
  }
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString())
    if (request.url === '/api/extract-questions') {
      const requestGeminiKey = payload.apiKey
      if (!requestGeminiKey) {
        send(response, 503, { error: 'GEMINI_API_KEY is not configured on the server.' })
        return
      }
      const extractionPrompt = `Extract only real SSC CHSL multiple-choice exam questions from this PDF text. A real question must ask something to solve, identify, calculate, complete, choose, or interpret. NEVER return website/interface metadata such as OVERVIEW, Test series, Add New Test, Generate HTML, Exam Category, Test Title, Mapping ID, Created From Date, Search, Clear, Coming Soon, or Paid Status. Ignore headers, footers, navigation labels, dates, page numbers, and metadata. Copy the question and options exactly as printed. Preserve every literal character, including (P), (Q), (R), (S), brackets, punctuation, symbols, units, negative signs, degree signs, fractions, and mathematical operators. Do not rename option labels to A/B/C/D and do not merge or rewrite option text. Return only valid JSON in this shape: {"questions":[{"question":"string","options":["string","string","string","string"],"optionLabels":["P","Q","R","S"],"answer":null,"section":"General Intelligence|Quantitative Aptitude|English Language|General Awareness","explanation":null}]}. Use optionLabels only when labels are visibly printed; otherwise use ["A","B","C","D"]. Do not invent missing options or answers. If a page has no real question, omit it. Source filename: ${payload.title}\n\nPDF text:\n${String(payload.text || '').slice(0, 120000)}`
      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${requestGeminiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: extractionPrompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
      })
      const data = await geminiResponse.json()
      if (!geminiResponse.ok) throw new Error(data.error?.message || 'Gemini extraction failed')
      const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{"questions":[]}')
      const questions = (parsed.questions || []).map((question) => ({ ...question, id: crypto.randomUUID(), options: question.options?.slice(0, 4) || [], answer: question.answer ?? null })).filter(isExamQuestion)
      send(response, 200, { questions })
      return
    }
    if (request.url === '/api/ask') {
      const provider = payload.provider || 'openai'
      const requestKey = payload.apiKey
      if (!requestKey) {
        send(response, 503, { error: provider === 'anthropic' ? 'Add an Anthropic API token in Ask AI settings.' : provider === 'gemini' ? 'GEMINI_API_KEY is not configured on the server.' : 'OPEN_AI_API_KEY is not configured on the server.' })
        return
      }
      const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : []
      if (provider === 'gemini') {
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${requestKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You are a concise SSC CHSL study coach. Explain answers step by step, use simple language, and never claim to predict future exam questions.' }] }, contents: messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })), generationConfig: { temperature: 0.2 } }),
        })
        const data = await geminiResponse.json()
        if (!geminiResponse.ok) throw new Error(data.error?.message || 'Gemini request failed')
        send(response, 200, { answer: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'Gemini returned no text.' })
        return
      }
      if (provider === 'anthropic') {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': requestKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 1000, system: 'You are a concise SSC CHSL study coach. Explain answers step by step, use simple language, and never claim to predict future exam questions.', messages }),
        })
        const data = await anthropicResponse.json()
        if (!anthropicResponse.ok) throw new Error(data.error?.message || 'Anthropic request failed')
        send(response, 200, { answer: data.content?.map((part) => part.text || '').join('') || 'Claude returned no text.' })
        return
      }
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: 'You are a concise SSC CHSL study coach. Explain answers step by step, use simple language, and never claim to predict future exam questions.' }, ...messages] }),
      })
      const data = await openAiResponse.json()
      if (!openAiResponse.ok) throw new Error(data.error?.message || 'OpenAI request failed')
      send(response, 200, { answer: data.choices[0].message.content })
      return
    }
    const { questions, answers } = payload
    const requestGeminiKey = payload.apiKey
    const prompt = questions.map((question, index) => `${index + 1}. ${question.question}\nOptions: ${question.options.join(' | ')}\nSelected: ${question.options[answers[question.id]] || 'Not attempted'}\nCorrect: ${question.options[question.answer] || 'Not provided'}`).join('\n\n')
    if (request.url === '/api/grade' && requestGeminiKey) {
      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${requestGeminiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Grade this SSC CHSL attempt. Determine the correct option index for every question, using zero-based indexes. Return only JSON in this shape: {"grades":[{"id":"question id","correctIndex":0,"explanation":"short solution"}]}. Never guess when the question is incomplete; use null for correctIndex.\n\n${questions.map((question) => `ID: ${question.id}\nQuestion: ${question.question}\nOptions: ${question.options.map((option, index) => `${index}: ${option}`).join(' | ')}\nSelected index: ${answers[question.id] ?? 'not attempted'}`).join('\n\n')}` }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
      })
      const data = await geminiResponse.json()
      if (!geminiResponse.ok) throw new Error(data.error?.message || 'Gemini grading failed')
      const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{"grades":[]}')
      send(response, 200, { grades: parsed.grades || [] })
      return
    }
    if (request.url === '/api/review' && requestGeminiKey) {
      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${requestGeminiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Review this SSC CHSL attempt. Explain the score briefly, identify mistakes, and provide solutions for the attempted questions. Do not predict future questions.\n\n${prompt}` }] }], generationConfig: { temperature: 0.2 } }),
      })
      const data = await geminiResponse.json()
      if (!geminiResponse.ok) throw new Error(data.error?.message || 'Gemini review failed')
      send(response, 200, { review: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'Gemini returned no review.' })
      return
    }
    if (!apiKey) {
      send(response, 503, { error: 'GEMINI_API_KEY is not configured or OpenAI has no available credits.' })
      return
    }
    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: 'You are a concise SSC CHSL exam coach. Return a short score interpretation, two strengths, and three specific study actions. Do not predict future questions.' }, { role: 'user', content: prompt }] }),
    })
    const data = await openAiResponse.json()
    if (!openAiResponse.ok) throw new Error(data.error?.message || 'OpenAI request failed')
    send(response, 200, { review: data.choices[0].message.content })
  } catch (error) {
    send(response, 500, { error: error.message })
  }
}).listen(port, () => console.log(`AI review server listening on http://localhost:${port}`))