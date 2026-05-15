const GEMINI_API_KEY = 'AIzaSyAS5ORmG9Q-at3K1RaOEofBn5m-Qnm9CfY'
const GEMINI_MODEL = 'gemini-1.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

// Explicit prompt with example — more reliable than responseSchema for arrays
const PROMPT = `Generate exactly 10 Hebrew trivia questions from 10 different topics.
Topics must vary: geography, sports, history, science, art, literature, technology, cinema, music, nature.

Return ONLY a raw JSON array — no markdown, no code fences, no text before or after.
Each element must follow this exact structure:
{"topic":"<topic in Hebrew>","question":"<question in Hebrew>","options":["opt1","opt2","opt3","opt4"],"correctIndex":<0-3>}

correctIndex is the 0-based index of the correct answer inside options.
All text (topic, question, options) must be in Hebrew.
Respond with NOTHING except the JSON array starting with [ and ending with ].`

function extractJSON(text) {
  // Try direct parse first
  try { return JSON.parse(text.trim()) } catch { }

  // Strip markdown code fences if present
  const stripped = text.replace(/```json?\s*/gi, '').replace(/```\s*/g, '').trim()
  try { return JSON.parse(stripped) } catch { }

  // Extract first [...] block
  const match = text.match(/\[[\s\S]*\]/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { }
  }

  throw new Error('לא ניתן לפרסר JSON מ-Gemini')
}

function validate(raw) {
  if (!Array.isArray(raw) || raw.length < 10) throw new Error('מספר שאלות שגוי')
  raw.forEach((q, i) => {
    if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`שאלה ${i + 1} פגומה`)
    }
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) {
      throw new Error(`correctIndex שגוי בשאלה ${i + 1}`)
    }
  })
}

async function callGemini() {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }] }],
      generationConfig: {
        temperature: 0.9
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText)
    throw new Error(`Gemini ${response.status}: ${err.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('תגובה ריקה מ-Gemini')

  const raw = extractJSON(text)
  validate(raw)
  return raw
}

export async function generateQuestions() {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callGemini()
      return raw.slice(0, 10).map((q, i) => ({
        id: i + 1,
        topic: q.topic || `נושא ${i + 1}`,
        category: q.topic || `נושא ${i + 1}`,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        correct: q.options[q.correctIndex],
      }))
    } catch (err) {
      lastError = err
      console.warn(`Gemini attempt ${attempt} failed:`, err.message)
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
  throw lastError
}
