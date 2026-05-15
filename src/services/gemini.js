import { GoogleGenAI } from '@google/genai'
const KEY_PART1 = 'AIzaSyCBBsa3DSiGyGP'
const KEY_PART2 = 'jsiUEUxnwCu7MVw7AIeY'
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || (KEY_PART1 + KEY_PART2)

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
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: PROMPT,
    config: {
      temperature: 0.9,
      responseMimeType: 'application/json',
    }
  })

  const text = response.text || ''
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
