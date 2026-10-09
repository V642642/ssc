const STORAGE_KEY = 'ssc-chsl-study-state'

const initialState = {
  theme: 'light',
  view: 'dashboard',
  activeTest: null,
  tests: [],
  notes: [],
  results: [],
  chat: [],
  apiTokens: [],
}

export function loadState() {
  try {
    return { ...initialState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  } catch {
    return initialState
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export { initialState }
