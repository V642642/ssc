import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import './App.css'
import 'katex/dist/katex.min.css'
import { questionFromText, extractPdfText } from './lib/pdfParser'
import { scoreTest } from './lib/scoring'
import { loadState, saveState } from './lib/storage'
import { extractQuestionsWithGemini, studyApiUrl } from './lib/geminiParser'
import { getSavedToken, hasSavedToken, removeSavedToken, saveEncryptedToken, unlockToken } from './lib/tokenVault'

const paperAssets = import.meta.glob('../*.pdf', { eager: true, query: '?url', import: 'default' })

const sampleQuestions = [
  { id: 'q1', question: 'If 18% of a number is 72, what is the number?', options: ['360', '400', '420', '450'], answer: 1, section: 'Quantitative Aptitude', explanation: '72 / 0.18 = 400.' },
  { id: 'q2', question: 'Choose the word most similar in meaning to “abundant”.', options: ['Rare', 'Plentiful', 'Tiny', 'Empty'], answer: 1, section: 'English Language', explanation: 'Abundant means available in large quantities.' },
  { id: 'q3', question: 'Complete the series: 3, 8, 15, 24, 35, ?', options: ['42', '46', '48', '50'], answer: 2, section: 'General Intelligence', explanation: 'The differences are 5, 7, 9, 11, then 13.' },
]

const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

function App() {
  const [geminiToken, setGeminiToken] = useState(() => getSavedToken())
  const [hasSavedGeminiToken, setHasSavedGeminiToken] = useState(() => hasSavedToken())
  const [state, setState] = useState(loadState)
  const [setup, setSetup] = useState({ title: 'SSC CHSL Focus Set', minutes: 30 })
  const [answers, setAnswers] = useState({})
  const [current, setCurrent] = useState(0)
  const [note, setNote] = useState({ title: '', body: '', image: '' })
  const [aiReview, setAiReview] = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [questionSolution, setQuestionSolution] = useState('')
  const [solutionLoading, setSolutionLoading] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importStage, setImportStage] = useState('')
  const [lastResult, setLastResult] = useState(null)
  const [tokenForm, setTokenForm] = useState({ label: '', provider: 'anthropic', value: '' })
  const [activeTokenId, setActiveTokenId] = useState('')
  const fileRef = useRef(null)
  const active = state.activeTest
  const rawQuestions = Array.isArray(active?.questions) && active.questions.length ? active.questions : sampleQuestions
  const questions = rawQuestions.map((question) => ({ ...question, options: (Array.isArray(question.options) ? question.options : []).map((option, index) => { const label = question.optionLabels?.[index]; return label && !String(option).trim().startsWith(`(${label})`) ? `(${label}) ${option}` : option }) }))
  const currentQuestion = questions[current]
  const score = useMemo(() => scoreTest(questions, answers), [questions, answers])

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setState((previous) => ({ ...previous, activeTest: { ...previous.activeTest, secondsLeft: Math.max(0, previous.activeTest.secondsLeft - 1) } })), 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!geminiToken) return <TokenLogin hasSavedToken={hasSavedGeminiToken} onLogin={async (token, remember) => { const unlocked = await unlockToken(token); if (!unlocked) return false; if (remember) { await saveEncryptedToken(token); setHasSavedGeminiToken(true) } setGeminiToken(token); return true }} onRemove={() => { removeSavedToken(); setHasSavedGeminiToken(false) }} />

  const navigate = (view) => setState((previous) => ({ ...previous, view }))
  const startTest = (selectedQuestions = questions, title = setup.title) => {
    const safeQuestions = Array.isArray(selectedQuestions) && selectedQuestions.length ? selectedQuestions : questions
    const test = { id: crypto.randomUUID(), title: typeof title === 'string' ? title : setup.title, secondsLeft: Number(setup.minutes) * 60, questions: safeQuestions, startedAt: new Date().toISOString() }
    setAnswers({}); setCurrent(0); setState((previous) => ({ ...previous, activeTest: test, view: 'test' }))
  }
  const finishTest = async () => {
    if (submitLoading) return
    setSubmitLoading(true)
    let gradedQuestions = questions
    let gradedScore = score
    let gradingSource = 'local'
    try {
      const response = await fetch(studyApiUrl('grade'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions, answers, apiKey: geminiToken }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Gemini grading failed')
      const grades = new Map((data.grades || []).map((grade) => [grade.id, grade]))
      gradedQuestions = questions.map((question) => ({ ...question, answer: grades.get(question.id)?.correctIndex ?? question.answer, explanation: grades.get(question.id)?.explanation || question.explanation }))
      gradedScore = scoreTest(gradedQuestions, answers)
      gradingSource = 'gemini'
    } catch (error) {
      console.error(error)
    }
    const result = { id: crypto.randomUUID(), title: active.title, score: gradedScore, answers, questions: gradedQuestions, completedAt: new Date().toISOString(), gradingSource }
    setLastResult({ ...result, questions: gradedQuestions })
    setAiReview('')
    setState((previous) => ({ ...previous, activeTest: null, results: [result, ...previous.results], view: 'results' }))
    setSubmitLoading(false)
  }
  const reviewAnswers = async () => {
    const reviewQuestions = lastResult?.questions || questions
    const reviewAnswerMap = lastResult?.answers || answers
    setReviewLoading(true); setAiReview('')
    try {
      const response = await fetch(studyApiUrl('review'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions: reviewQuestions, answers: reviewAnswerMap, apiKey: geminiToken }) })
      const data = await response.json()
      setAiReview(data.review || data.error || 'The review could not be generated.')
    } catch { setAiReview('Start the secure review server with `npm run server` first.') }
    finally { setReviewLoading(false) }
  }
  const explainCurrentQuestion = async () => {
    if (solutionLoading || !currentQuestion) return
    setSolutionLoading(true); setQuestionSolution('')
    try {
      const prompt = `Explain this SSC CHSL question step by step. Give the correct option and a simple method. Do not predict future questions. Question: ${currentQuestion.question}\nOptions: ${currentQuestion.options.map((option, index) => `${index}: ${option}`).join(' | ')}`
      const response = await fetch(studyApiUrl('ask-ai'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'gemini', apiKey: geminiToken, messages: [{ role: 'user', content: prompt }] }) })
      const data = await response.json()
      setQuestionSolution(data.answer || data.error || 'No explanation was returned.')
    } catch { setQuestionSolution('Start the secure AI server with `npm run server` first.') }
    finally { setSolutionLoading(false) }
  }
  const askStudyCoach = async () => {
    const question = chatInput.trim()
    if (!question || chatLoading) return
    const userMessage = { role: 'user', content: question }
    const messages = [...(state.chat || []), userMessage]
    setChatInput(''); setChatLoading(true)
    setState((previous) => ({ ...previous, chat: [...(previous.chat || []), userMessage] }))
    const selectedToken = (state.apiTokens || []).find((token) => token.id === activeTokenId)
    try {
      const response = await fetch(studyApiUrl('ask-ai'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, provider: 'gemini', apiKey: geminiToken || selectedToken?.value }) })
      const data = await response.json()
      const assistantMessage = { role: 'assistant', content: data.answer || data.error || 'The study coach could not respond.' }
      setState((previous) => ({ ...previous, chat: [...(previous.chat || []), assistantMessage] }))
    } catch {
      setState((previous) => ({ ...previous, chat: [...(previous.chat || []), { role: 'assistant', content: 'Start the secure AI server with `npm run server`, then ask again.' }] }))
    } finally { setChatLoading(false) }
  }
  const saveToken = () => {
    if (!tokenForm.value.trim()) return
    const token = { id: crypto.randomUUID(), label: tokenForm.label.trim() || `${tokenForm.provider} token`, provider: tokenForm.provider, value: tokenForm.value.trim() }
    setState((previous) => ({ ...previous, apiTokens: [...(previous.apiTokens || []), token] }))
    setActiveTokenId(token.id); setTokenForm({ label: '', provider: tokenForm.provider, value: '' })
  }
  const removeToken = (id) => {
    setState((previous) => ({ ...previous, apiTokens: (previous.apiTokens || []).filter((token) => token.id !== id) }))
    if (activeTokenId === id) setActiveTokenId('')
  }
  const openHistoryResult = (result) => {
    setLastResult(result); setAiReview(''); setState((previous) => ({ ...previous, view: 'results' }))
  }
  const importPdf = async (event) => {
    const file = event.target.files[0]
    if (!file) return
    setImportLoading(true); setImportStage('Reading PDF pages...'); setImportStatus('')
    let started = false
    try {
      const text = await extractPdfText(file)
      const imported = await extractQuestionsWithGemini(text, file.name, geminiToken, ({ completed, total }) => {
        setImportStage(`Loading batch ${completed} of ${total} in the background...`)
        if (started) setImportStatus(`Test started. Loaded ${completed} of ${total} paper batches.`)
      }, (batchQuestions) => {
        if (!batchQuestions.length) return
        setState((previous) => {
          const existing = previous.activeTest?.questions || []
          const combined = [...existing, ...batchQuestions]
          if (!started) {
            started = true
            setAnswers({}); setCurrent(0)
            return { ...previous, tests: combined, activeTest: { id: crypto.randomUUID(), title: file.name, secondsLeft: Number(setup.minutes) * 60, questions: combined, startedAt: new Date().toISOString() }, view: 'test' }
          }
          return { ...previous, tests: combined, activeTest: previous.activeTest ? { ...previous.activeTest, questions: combined } : previous.activeTest }
        })
        setImportLoading(false)
        setImportStatus(`Test started. More paper questions are loading in the background.`)
      })
      if (!started) {
        setState((previous) => ({ ...previous, tests: imported, view: 'dashboard' }))
        setImportStatus(`Imported ${imported.length} questions from ${file.name}`)
      }
    } catch (error) {
      const imported = questionFromText(text, file.name)
      setState((previous) => ({ ...previous, tests: [imported, ...previous.tests], view: 'dashboard' }))
      setImportStatus(`Gemini extraction unavailable. Imported 1 starter question from ${file.name}`)
      console.error(error)
    } finally {
      setImportLoading(false); setImportStage('')
    }
  }
  const addNote = () => {
    if (!note.title && !note.body && !note.image) return
    setState((previous) => ({ ...previous, notes: [{ ...note, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...previous.notes] }))
    setNote({ title: '', body: '', image: '' })
  }
  const attachImage = (event) => {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader(); reader.onload = () => setNote((previous) => ({ ...previous, image: reader.result })); reader.readAsDataURL(file)
  }
  const openPaper = async (paper) => {
    setImportLoading(true); setImportStage(`Reading ${paper.title}...`); setImportStatus('')
    try {
      const response = await fetch(paper.url)
      if (!response.ok) throw new Error(`Could not load ${paper.file} (${response.status}).`)
      const text = await extractPdfText(await response.blob())
      const imported = await extractQuestionsWithGemini(text, paper.title, geminiToken, ({ completed, total }) => setImportStage(`Loading ${paper.title}: batch ${completed} of ${total}...`))
      if (!imported.length) throw new Error('No exam questions were found in this paper.')
      startTest(imported, paper.title)
    } catch (error) {
      setImportStatus(error.message)
      setState((previous) => ({ ...previous, view: 'library' }))
    } finally {
      setImportLoading(false); setImportStage('')
    }
  }

  return <div className={`app-shell ${state.theme}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">S</span><span>Study Desk<small>SSC CHSL / 2026</small></span></div>
      <nav>
        {[['dashboard', '⌂', 'Overview'], ['test', '◈', 'Test runner'], ['history', '↺', 'Test history'], ['library', '▤', 'Paper library'], ['notes', '✎', 'My notes'], ['ask', '?', 'Ask AI']].map(([view, icon, label]) => <button className={state.view === view ? 'nav-item active' : 'nav-item'} onClick={() => navigate(view)} key={view}><span>{icon}</span>{label}</button>)}
      </nav>
      <div className="sidebar-foot"><span>LOCAL-FIRST</span><p>Your progress is saved in this browser.</p></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">THURSDAY · 08 OCT 2026</span><h1>{state.view === 'test' ? 'Focus mode' : 'Good evening, Vishal'}</h1></div><div className="top-actions"><button className="icon-button" onClick={() => setState((previous) => ({ ...previous, theme: previous.theme === 'light' ? 'dark' : 'light' }))} aria-label="Toggle theme">{state.theme === 'light' ? '☾' : '☀'}</button><button className="logout-button" onClick={() => setGeminiToken(null)}>Logout</button><div className="avatar">VM</div></div></header>
      {state.view === 'dashboard' && <Dashboard setup={setup} setSetup={setSetup} startTest={startTest} importPdf={importPdf} fileRef={fileRef} state={state} navigate={navigate} importStatus={importStatus} />}
      {state.view === 'test' && <><TestRunner active={active} current={current} setCurrent={setCurrent} questions={questions} currentQuestion={currentQuestion} answers={answers} setAnswers={setAnswers} finishTest={finishTest} submitLoading={submitLoading} reviewAnswers={reviewAnswers} aiReview={aiReview} reviewLoading={reviewLoading} /><QuestionHelp solution={questionSolution} loading={solutionLoading} explain={explainCurrentQuestion} /></>}
      {state.view === 'results' && <Results result={lastResult} aiReview={aiReview} reviewAnswers={reviewAnswers} reviewLoading={reviewLoading} navigate={navigate} />}
      {state.view === 'history' && <History results={state.results || []} openResult={openHistoryResult} navigate={navigate} />}
      {state.view === 'library' && <Library navigate={navigate} openPaper={openPaper} importStatus={importStatus} />}
      {state.view === 'notes' && <Notes note={note} setNote={setNote} addNote={addNote} attachImage={attachImage} state={state} />}
      {state.view === 'ask' && <><div className="chat-toolbar"><button className="quiet-button" onClick={() => setState((previous) => ({ ...previous, chat: [] }))}>＋ New chat</button></div><AskAI chat={state.chat || []} input={chatInput} setInput={setChatInput} ask={askStudyCoach} loading={chatLoading} tokens={state.apiTokens || []} activeTokenId={activeTokenId} setActiveTokenId={setActiveTokenId} tokenForm={tokenForm} setTokenForm={setTokenForm} saveToken={saveToken} removeToken={removeToken} /></>}
    </main>
    {importLoading && <div className="import-overlay" role="status"><div className="loader-orbit"><span /></div><strong>{importStage}</strong><p>Long papers are processed in small parallel batches.</p></div>}
  </div>
}
function TokenLogin({ hasSavedToken, onLogin, onRemove }) {
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!token.trim()) return setError('Enter a Gemini API token to continue.')
    setLoading(true); setError('')
    const accepted = await onLogin(token.trim(), remember)
    if (!accepted) setError('This token could not unlock the saved local token. Enter the same token or remove the saved token.')
    setLoading(false)
  }

  return <main className="token-login"><div className="token-login-card"><span className="brand-mark">S</span><span className="eyebrow coral">PRIVATE STUDY DESK</span><h1>Unlock your<br /><em>Gemini coach.</em></h1><p>Your token is encrypted with Web Crypto before it is saved in this browser. It is never committed to the project.</p><a className="token-guide-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get a Gemini API token ↗</a><details className="token-guide"><summary>How do I get one?</summary><ol><li>Open Google AI Studio.</li><li>Sign in with your Google account.</li><li>Choose <strong>Get API key</strong> or <strong>Create API key</strong>.</li><li>Copy the key and paste it below.</li></ol><p>Use a separate key for this app and never share it publicly.</p></details><form onSubmit={submit}><label>Gemini API token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste your Gemini token" autoComplete="off" /></label><label className="remember-token"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember this browser</label>{error && <div className="token-error">{error}</div>}<button className="primary-button" disabled={loading}>{loading ? 'Submitting...' : 'Submit key & continue →'}</button></form>{hasSavedToken && <button className="quiet-button remove-saved-token" onClick={onRemove}>Remove saved token</button>}<small>Local encryption helps protect stored data, but do not use this on a shared or compromised computer.</small></div></main>
}

function Dashboard({ setup, setSetup, startTest, importPdf, fileRef, state, navigate, importStatus }) {
  const startImported = () => startTest(Array.isArray(state.tests) ? state.tests : [], 'Imported paper')
  return <div className="page-grid"><section className="hero-panel"><div><span className="eyebrow coral">YOUR NEXT SESSION</span><h2>Make today’s<br /><em>attempt count.</em></h2><p>Build a calm, repeatable practice habit with papers you can trust.</p><button className="primary-button" onClick={startTest}>Start a focused test <span>→</span></button></div><div className="hero-stamp">SSC<br /><strong>CHSL</strong><small>PREP / 2026</small></div></section><section className="section-heading"><div><span className="eyebrow">QUICK ACTIONS</span><h2>Prepare your desk</h2></div></section><section className="action-grid"><div className="action-card"><span className="card-icon">↥</span><h3>Bring in a paper</h3><p>Upload a PDF and turn its first question into a study set.</p><button className="text-button" onClick={() => fileRef.current.click()}>Choose PDF <span>→</span></button><input ref={fileRef} type="file" accept="application/pdf" hidden onChange={importPdf} />{importStatus && <><p className="import-status">{importStatus}</p><button className="primary-button small imported-start" onClick={startImported}>Start imported paper →</button></>}</div><div className="action-card dark-card"><span className="card-icon">◷</span><h3>Set the clock</h3><p>Choose your own pace. Section timing can be changed before you begin.</p><label className="field-label">Test name<input value={setup.title} onChange={(event) => setSetup({ ...setup, title: event.target.value })} /></label><label className="field-label">Minutes<input type="number" min="5" max="180" value={setup.minutes} onChange={(event) => setSetup({ ...setup, minutes: event.target.value })} /></label></div></section><section className="section-heading"><div><span className="eyebrow">RECENT RHYTHM</span><h2>Keep your streak visible</h2></div><button className="text-button" onClick={() => navigate('library')}>Browse papers <span>→</span></button></section><section className="stats-row"><div><strong>{state.results.length || 0}</strong><span>tests finished</span></div><div><strong>{state.notes.length || 0}</strong><span>notes captured</span></div><div><strong>0</strong><span>predictions here</span></div></section></div>
}

function TestRunner({ active, current, setCurrent, questions, currentQuestion, answers, setAnswers, finishTest, submitLoading, reviewAnswers, aiReview, reviewLoading }) {
  if (!active) return <div className="empty-state"><h2>Ready when you are.</h2><p>Start a test from the overview to enter focus mode.</p></div>
  return <div className="test-layout"><section className="test-main"><div className="test-meta"><span>{active.title}</span><strong>{formatTime(active.secondsLeft)}</strong></div><div className="progress-line"><span style={{ width: `${((current + 1) / questions.length) * 100}%` }} /></div><div className="question-card"><span className="eyebrow">QUESTION {String(current + 1).padStart(2, '0')} / {String(questions.length).padStart(2, '0')}</span><span className="section-tag">{currentQuestion.section}</span><h2>{currentQuestion.question}</h2><div className="options">{currentQuestion.options.map((option, index) => <button className={answers[currentQuestion.id] === index ? 'option selected' : 'option'} key={option} onClick={() => setAnswers({ ...answers, [currentQuestion.id]: index })}><span>{String.fromCharCode(65 + index)}</span>{option}</button>)}</div><div className="question-footer"><button className="quiet-button" disabled={current === 0} onClick={() => setCurrent(current - 1)}>← Previous</button>{current < questions.length - 1 ? <button className="primary-button small" onClick={() => setCurrent(current + 1)}>Next question →</button> : <button className="primary-button small" onClick={finishTest} disabled={submitLoading}>{submitLoading ? 'Gemini is grading...' : 'Finish test'}</button>}</div></div></section><aside className="question-map"><span className="eyebrow">QUESTION MAP</span><div>{questions.map((question, index) => <button className={index === current ? 'map-dot current' : answers[question.id] !== undefined ? 'map-dot answered' : 'map-dot'} onClick={() => setCurrent(index)} key={question.id}>{index + 1}</button>)}</div><p>{Object.keys(answers).length} answered · {questions.length - Object.keys(answers).length} remaining</p><div className="review-box"><strong>AI review</strong><p>{aiReview || 'Get concise feedback on this attempt from your secure server.'}</p><button className="text-button" onClick={reviewAnswers} disabled={reviewLoading}>{reviewLoading ? 'Reviewing...' : 'Review my answers →'}</button></div></aside></div>
}

function Results({ result, aiReview, reviewAnswers, reviewLoading, navigate }) {
  if (!result) return <div className="empty-state"><h2>No result yet.</h2><button className="primary-button" onClick={() => navigate('dashboard')}>Back to overview</button></div>
  return <div className="results-page"><span className="eyebrow coral">ATTEMPT COMPLETE</span><h2>{result.title}<br /><em>here is your result.</em></h2><div className="result-score"><strong>{result.score.marks}</strong><span>marks</span><small>{result.score.correct} correct · {result.score.attempted} attempted · {result.score.accuracy}% accuracy</small></div><div className="result-actions"><button className="primary-button" onClick={reviewAnswers} disabled={reviewLoading}>{reviewLoading ? 'Preparing solutions...' : 'Explain solutions with AI →'}</button><button className="quiet-button" onClick={() => navigate('dashboard')}>Back to overview</button></div>{aiReview && <article className="solution-card"><span className="eyebrow">COACH NOTES</span><FormattedText content={aiReview} /></article>}</div>
}

function History({ results, openResult, navigate }) {
  return <div className="history-page"><span className="eyebrow coral">YOUR RECORD</span><h2>Past attempts,<br /><em>still useful.</em></h2>{results.length === 0 ? <div className="empty-state"><p>No completed tests yet.</p><button className="primary-button" onClick={() => navigate('dashboard')}>Start your first test →</button></div> : <div className="history-list">{results.map((result) => <article className="history-row" key={result.id}><div><span className="eyebrow">{new Date(result.completedAt).toLocaleString()}</span><h3>{result.title}</h3><p>{result.score.correct} correct · {result.score.attempted} attempted · {result.score.accuracy}% accuracy</p></div><strong>{result.score.marks}<small> marks</small></strong><button className="text-button" onClick={() => openResult(result)}>View result →</button></article>)}</div>}</div>
}

function QuestionHelp({ solution, loading, explain }) {
  return <section className="question-help"><button className="text-button" onClick={explain} disabled={loading}>{loading ? 'Gemini is explaining...' : 'Need help? Show solution →'}</button>{solution && <div className="question-solution"><span className="eyebrow">STEP-BY-STEP SOLUTION</span><FormattedText content={solution} /></div>}</section>
}

function FormattedText({ content }) {
  return <div className="formatted-text"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown></div>
}

function paperDetails(file, url) {
  const base = file.replace(/\.pdf$/i, '')
  const dateOnly = base.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/i)
  if (dateOnly) return { file, url, title: `${dateOnly[1]} ${dateOnly[2]} ${dateOnly[3]}` }
  const match = base.match(/^(\d{1,2})-([A-Za-z]{3})(?:-(\d{4}))?(?:-2025)?-(?:Shift-)?S?(\d+)(?:-(.+?))?(?:-pdf)?$/i)
  if (!match) return { file, url, title: base.replace(/-/g, ' ') }
  const [, day, month, year, shift, suffix] = match
  const detail = suffix && suffix.toLowerCase() !== 'pdf' ? ` · ${suffix.replace(/-/g, ' ')}` : ''
  return { file, url, title: `${day} ${month}${year ? ` ${year}` : ''} · Shift ${shift}${detail}` }
}

function Library({ navigate, openPaper, importStatus }) {
  const papers = Object.entries(paperAssets).map(([path, url]) => {
    const file = path.split('/').pop()
    return paperDetails(file, url)
  }).sort((first, second) => second.file.localeCompare(first.file))
  return <div className="library-page"><div className="library-intro"><span className="eyebrow coral">THE ARCHIVE</span><h2>Previous year papers,<br /><em>without the noise.</em></h2><p>Practice what has actually appeared. No prediction, no invented questions.</p></div>{importStatus && <p className="import-status">{importStatus}</p>}<div className="paper-list">{papers.map((paper, index) => <article className="paper-row" key={paper.file}><span className="paper-year">{String(index + 1).padStart(2, '0')}</span><div><h3>{paper.title}</h3><p>{paper.file} · Gemini extracts questions when opened</p></div><button className="text-button" onClick={() => openPaper(paper)}>Practice paper <span>→</span></button></article>)}</div><button className="quiet-button" onClick={() => navigate('dashboard')}>← Back to overview</button></div>
}

function Notes({ note, setNote, addNote, attachImage, state }) { return <div className="notes-page"><div className="section-heading"><div><span className="eyebrow coral">YOUR MARGIN</span><h2>Capture the useful bits</h2></div></div><section className="note-composer"><input placeholder="Note title" value={note.title} onChange={(event) => setNote({ ...note, title: event.target.value })} /><textarea placeholder="Write a shortcut, explanation, or reminder..." value={note.body} onChange={(event) => setNote({ ...note, body: event.target.value })} /><div className="composer-actions"><label className="text-button">Add screenshot <input type="file" accept="image/*" hidden onChange={attachImage} /></label>{note.image && <img className="thumb" src={note.image} alt="Note attachment preview" />}<button className="primary-button small" onClick={addNote}>Save note</button></div></section><div className="saved-notes">{state.notes.map((item) => <article className="saved-note" key={item.id}><span className="eyebrow">{new Date(item.createdAt).toLocaleDateString()}</span><h3>{item.title || 'Untitled note'}</h3><p>{item.body}</p>{item.image && <img src={item.image} alt="Attached study screenshot" />}</article>)}</div></div> }

function AskAI({ chat, input, setInput, ask, loading, tokens, activeTokenId, setActiveTokenId, tokenForm, setTokenForm, saveToken, removeToken }) {
  const [tokensOpen, setTokensOpen] = useState(false)

  return <div className="ask-page"><div className="ask-intro"><span className="eyebrow coral">YOUR STUDY COACH</span><h2>Ask the question<br /><em>you are stuck on.</em></h2><p>Get a clear explanation, a worked method, or a quick revision shortcut. This coach does not predict future questions.</p></div><button className="token-toggle" onClick={() => setTokensOpen(!tokensOpen)}>{tokensOpen ? '× Close API tokens' : '⚙ API tokens'}<span>{tokens.length ? `${tokens.length} saved` : 'Add Claude or OpenAI'}</span></button>{tokensOpen && <section className="token-panel"><div><span className="eyebrow">AI PROVIDER</span><strong>Choose a saved token</strong><small>Tokens are saved only in this browser. Do not use this on a shared computer.</small></div><select value={activeTokenId} onChange={(event) => setActiveTokenId(event.target.value)}><option value="">OpenAI server key</option>{tokens.map((token) => <option value={token.id} key={token.id}>{token.label} · {token.provider}</option>)}</select><div className="token-form"><input placeholder="Name, e.g. Claude personal" value={tokenForm.label} onChange={(event) => setTokenForm({ ...tokenForm, label: event.target.value })} /><select value={tokenForm.provider} onChange={(event) => setTokenForm({ ...tokenForm, provider: event.target.value })}><option value="anthropic">Claude</option><option value="openai">OpenAI</option></select><input type="password" placeholder="Paste API token" value={tokenForm.value} onChange={(event) => setTokenForm({ ...tokenForm, value: event.target.value })} /><button className="text-button" onClick={saveToken}>Save token</button></div>{tokens.length > 0 && <div className="token-list">{tokens.map((token) => <span key={token.id}>{token.label}<button onClick={() => removeToken(token.id)} aria-label={`Remove ${token.label}`}>×</button></span>)}</div>}</section>}<section className="chat-window"><div className="chat-messages">{chat.length === 0 && <div className="chat-empty"><span>?</span><h3>What are you working through?</h3><p>Try: “Explain percentage increase in a simple way.”</p></div>}{chat.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><span className="message-label">{message.role === 'user' ? 'YOU' : 'COACH'}</span><p>{message.content}</p></div>)}</div><div className="chat-compose"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask() } }} placeholder="Ask a study question..." rows="3" /><button className="primary-button" onClick={ask} disabled={loading}>{loading ? 'Thinking...' : 'Ask coach →'}</button></div></section></div>
}

export default App
