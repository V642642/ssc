export function scoreTest(questions, answers) {
  const safeQuestions = Array.isArray(questions) ? questions : []
  const safeAnswers = answers || {}
  const correct = safeQuestions.filter((question) => safeAnswers[question.id] === question.answer).length
  const attempted = safeQuestions.filter((question) => safeAnswers[question.id] !== undefined).length
  const marks = correct * 2
  return {
    correct,
    attempted,
    total: safeQuestions.length,
    marks,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
  }
}
