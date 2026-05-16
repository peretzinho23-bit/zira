/**
 * Board.jsx — לוח כיבוש טריטוריות | הזירה
 * ═══════════════════════════════════════════
 * רשת 5×5 של 25 טריטוריות. שחקן מתחיל בתא 0 (פינה שמאל עליונה).
 * לחיצה על תא שכן = פתיחת דו-קרב. ניצחון = כיבוש הטריטוריה.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GoogleGenAI } from '@google/genai'

// ─────────────────────────────── Constants ────────────────────────────────────

const GRID       = 5
const PLAYER_ID  = 'player'
const TIMER_S    = 45
const SKIP_PEN   = 3
const MAX_STRIKES = 3
const REVEAL_MS  = 1300

const KEY_PART1 = 'AIzaSyAJhL3KJRvk'
const KEY_PART2 = 'Et0o0sDmobzdH5zJ5E18PFg'
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || (KEY_PART1 + KEY_PART2)

// 12 נושאים, מחולקים מחדש על 24 תאי אויב
const TOPICS_24 = [
  'ספורט', 'היסטוריה', 'מדע', 'בידור', 'גיאוגרפיה', 'מוזיקה',
  'קולנוע', 'אמנות', 'ספרות', 'טכנולוגיה', 'מיתולוגיה', 'בישול',
  'ספורט', 'היסטוריה', 'מדע', 'גיאוגרפיה', 'מוזיקה', 'בידור',
  'טכנולוגיה', 'אמנות', 'ספרות', 'קולנוע', 'מדע', 'ספורט',
]

// קושי: 8 קל + 10 בינוני + 6 קשה
const DIFFS_24 = [
  'קל', 'בינוני', 'קל', 'בינוני', 'קשה', 'בינוני',
  'קל', 'קשה', 'בינוני', 'קל', 'בינוני', 'קשה',
  'בינוני', 'קל', 'קשה', 'בינוני', 'קל', 'בינוני',
  'קשה', 'בינוני', 'קל', 'בינוני', 'קשה', 'בינוני',
]

// פלטת 12 צבעים (0 = שחקן)
const PALETTE = [
  { bg: '#065f46', border: '#34d399', glow: 'rgba(52,211,153,0.65)'  },  // 0 emerald — player
  { bg: '#581c87', border: '#c084fc', glow: 'rgba(192,132,252,0.65)' },  // 1 purple
  { bg: '#1e3a8a', border: '#60a5fa', glow: 'rgba(96,165,250,0.65)'  },  // 2 blue
  { bg: '#7c2d12', border: '#fb923c', glow: 'rgba(251,146,60,0.65)'  },  // 3 orange
  { bg: '#7f1d1d', border: '#f87171', glow: 'rgba(248,113,113,0.65)' },  // 4 red
  { bg: '#134e4a', border: '#2dd4bf', glow: 'rgba(45,212,191,0.65)'  },  // 5 teal
  { bg: '#312e81', border: '#818cf8', glow: 'rgba(129,140,248,0.65)' },  // 6 indigo
  { bg: '#831843', border: '#f472b6', glow: 'rgba(244,114,182,0.65)' },  // 7 pink
  { bg: '#713f12', border: '#fbbf24', glow: 'rgba(251,191,36,0.65)'  },  // 8 yellow
  { bg: '#164e63', border: '#22d3ee', glow: 'rgba(34,211,238,0.65)'  },  // 9 cyan
  { bg: '#881337', border: '#fb7185', glow: 'rgba(251,113,133,0.65)' },  // 10 rose
  { bg: '#365314', border: '#a3e635', glow: 'rgba(163,230,53,0.65)'  },  // 11 lime
]

// ─────────────────────────── Board init ───────────────────────────────────────

function initBoard() {
  return Array.from({ length: GRID * GRID }, (_, id) => {
    const row = Math.floor(id / GRID)
    const col = id % GRID
    if (id === 0) {
      return { id, row, col, owner: PLAYER_ID, ownerName: 'אתה', topic: 'מגוון', difficulty: null, colorKey: 0 }
    }
    const botIdx    = id - 1          // 0..23
    const colorKey  = (id % 11) + 1   // 1..11 cycling
    return {
      id, row, col,
      owner:      `bot-${id}`,
      ownerName:  `שחקן ${id}`,
      topic:      TOPICS_24[botIdx % TOPICS_24.length],
      difficulty: DIFFS_24[botIdx % DIFFS_24.length],
      colorKey,
    }
  })
}

function getAdjacentIds(id) {
  const row = Math.floor(id / GRID)
  const col = id % GRID
  const adj = []
  if (row > 0)            adj.push(id - GRID)   // up
  if (row < GRID - 1)     adj.push(id + GRID)   // down
  if (col > 0)            adj.push(id - 1)      // left
  if (col < GRID - 1)     adj.push(id + 1)      // right
  return adj
}

// ──────────────────────── Gemini (board-local) ────────────────────────────────

function boardPrompt(topic) {
  return `Generate exactly 10 Hebrew trivia questions about the topic: ${topic}.
Return ONLY a raw JSON array. No markdown. No code fences. No extra text.
Format: [{"topic":"<Hebrew>","question":"<Hebrew>","options":["a","b","c","d"],"correctIndex":<0-3>}]
All text in Hebrew. Start with [ and end with ].`
}

async function generateBoardQuestions(topic) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY })
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res  = await ai.models.generateContent({
        model:    'gemini-2.5-flash-lite',
        contents: boardPrompt(topic),
        config:   { temperature: 0.9, responseMimeType: 'application/json' },
      })
      const text = res.text ?? ''
      let raw
      try { raw = JSON.parse(text.trim()) } catch {
        const m = text.match(/\[[\s\S]*\]/)
        if (!m) throw new Error('No JSON')
        raw = JSON.parse(m[0])
      }
      if (!Array.isArray(raw) || raw.length < 5) throw new Error('Too few questions')
      return raw.slice(0, 10).map((q, i) => ({
        id:           i + 1,
        topic:        q.topic        ?? topic,
        category:     q.topic        ?? topic,
        question:     q.question     ?? '',
        options:      Array.isArray(q.options) ? q.options.slice(0, 4) : [],
        correctIndex: Number(q.correctIndex ?? 0),
        correct:      (q.options ?? [])[q.correctIndex] ?? '',
      }))
    } catch (err) {
      console.warn(`Board Gemini attempt ${attempt}:`, err.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 800 * attempt))
      else throw err
    }
  }
}

// ─────────────────────── Shared small components ─────────────────────────────

const OPT_LABELS = ['א', 'ב', 'ג', 'ד']

function DuelTimerRing({ secs, max = TIMER_S, active, px = 64 }) {
  const r  = (px - 8) / 2
  const cf = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, secs / max))
  const color = secs > 15 ? '#a855f7' : secs > 7 ? '#f59e0b' : '#ef4444'
  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: px, height: px }}>
      <svg width={px} height={px} className="absolute -rotate-90">
        <circle cx={px/2} cy={px/2} r={r} fill="none" stroke="#1e1e2e" strokeWidth={5} />
        <circle cx={px/2} cy={px/2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={cf} strokeDashoffset={cf * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.12s linear, stroke 0.3s',
                   filter: active ? `drop-shadow(0 0 4px ${color})` : 'none' }} />
      </svg>
      <span className={`relative z-10 text-sm font-black tabular-nums ${secs <= 7 ? 'text-red-400' : secs <= 15 ? 'text-yellow-400' : 'text-white'} ${active && secs <= 7 ? 'animate-pulse' : ''}`}>
        {Math.ceil(Math.max(0, secs))}
      </span>
    </div>
  )
}

function DuelStrikes({ count, max = MAX_STRIKES }) {
  return (
    <div className="flex gap-1 justify-center">
      {Array.from({ length: max }).map((_, i) => (
        <motion.div key={i}
          animate={i === count - 1 && count > 0 ? { scale: [1, 1.4, 1] } : {}}
          transition={{ duration: 0.3 }}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-black ${
            i < count
              ? 'bg-red-600 border-red-400 text-white shadow-[0_0_6px_rgba(239,68,68,0.5)]'
              : 'bg-[#0a0a0f] border-[#1e1e2e] text-gray-700'
          }`}>
          {i < count ? '✕' : '○'}
        </motion.div>
      ))}
    </div>
  )
}

function DuelGenerating() {
  const msgs = ['מכין את הדו-קרב...', 'טוען שאלות...', 'מרכיב את הזירה...']
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % msgs.length), 1800)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20">
      <div className="relative w-20 h-20">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full border-4 border-t-[#a855f7] border-r-[#a855f7] border-b-transparent border-l-transparent" />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">⚔️</div>
      </div>
      <AnimatePresence mode="wait">
        <motion.p key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}
          className="text-[#a855f7] font-bold text-base" style={{ textShadow: '0 0 10px rgba(168,85,247,0.6)' }}>
          {msgs[idx]}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────── BoardDuel component ─────────────────────────────
// Self-contained duel vs bot with specific topic.
// Calls onComplete(won: boolean) when the duel finishes.

const BOT_ACCURACY = { 'קל': 0.45, 'בינוני': 0.65, 'קשה': 0.82 }
const BOT_NAME     = '🤖 שומר הטריטוריה'

function BoardDuel({ topic, difficulty, user, onComplete }) {
  const accuracy = BOT_ACCURACY[difficulty] ?? 0.65

  const [phase,         setPhase]         = useState('loading')
  const [questions,     setQuestions]     = useState(null)
  const [genErr,        setGenErr]        = useState(null)
  const [qIdx,          setQIdx]          = useState(0)
  const [turn,          setTurn]          = useState('player')
  const [playerStrikes, setPS]            = useState(0)
  const [botStrikes,    setBS]            = useState(0)
  const [playerTimeBank,setPTB]           = useState(TIMER_S)
  const [botTimeBank,   setBTB]           = useState(TIMER_S)
  const [turnStarted,   setTurnStarted]   = useState(Date.now())
  const [timerDisplay,  setTimerDisplay]  = useState({ player: TIMER_S, bot: TIMER_S })
  const [reveal,        setReveal]        = useState(null)
  const [botThinking,   setBotThinking]   = useState(false)
  const [result,        setResult]        = useState(null)  // 'player-win' | 'bot-win'
  const processingRef = useRef(false)

  // Load questions
  useEffect(() => {
    generateBoardQuestions(topic)
      .then(qs => { setQuestions(qs); setPhase('playing'); setTurnStarted(Date.now()) })
      .catch(err => { setGenErr(err.message); setPhase('error') })
  }, [topic])

  // Countdown
  useEffect(() => {
    if (phase !== 'playing' || reveal || botThinking || result) return
    const activeTurn = turn
    const startedAt  = turnStarted
    const bank       = activeTurn === 'player' ? playerTimeBank : botTimeBank

    const id = setInterval(() => {
      const elapsed   = (Date.now() - startedAt) / 1000
      const remaining = Math.max(0, bank - elapsed)
      setTimerDisplay(prev => ({ ...prev, [activeTurn]: remaining }))

      if (remaining <= 0 && !processingRef.current) {
        clearInterval(id)
        processingRef.current = true
        setResult(activeTurn === 'player' ? 'bot-win' : 'player-win')
      }
    }, 100)
    return () => clearInterval(id)
  }, [turn, turnStarted, phase, reveal, botThinking, result]) // eslint-disable-line

  // Bot AI
  useEffect(() => {
    if (turn !== 'bot' || !questions || reveal || phase !== 'playing' || result) return
    setBotThinking(true)
    const delay = 3000 + Math.random() * 4000
    const t = setTimeout(() => {
      setBotThinking(false)
      if (processingRef.current || result) return
      const q    = questions[qIdx]
      const rand = Math.random()
      if      (rand < 0.10)      handleBotAction('skip', q)
      else if (rand < 1 - accuracy) {
        const wrong = q.options.filter(o => o !== q.correct)
        handleBotAction(wrong[Math.floor(Math.random() * wrong.length)], q)
      } else                     handleBotAction(q.correct, q)
    }, delay)
    return () => clearTimeout(t)
  }, [turn, qIdx, questions, phase, result]) // eslint-disable-line

  function calcRem(who, bank, start) {
    return who === turn ? Math.max(0, bank - (Date.now() - start) / 1000) : bank
  }

  function advance(newTurn, myRem, setMyTB) {
    setMyTB(myRem)
    setTimerDisplay(prev => ({ ...prev, [turn]: myRem }))
    setTurn(newTurn)
    setTurnStarted(Date.now())
    processingRef.current = false
  }

  function endByTime(pTime, bTime) {
    setResult(pTime >= bTime ? 'player-win' : 'bot-win')
  }

  function handlePlayerAnswer(sel) {
    if (turn !== 'player' || reveal || phase !== 'playing' || processingRef.current) return
    processingRef.current = true
    const q         = questions[qIdx]
    const isCorrect = sel === q.correct
    const myRem     = calcRem('player', playerTimeBank, turnStarted)
    let newPS       = playerStrikes

    if (!isCorrect) {
      newPS = playerStrikes + 1
      setPS(newPS)
      if (newPS >= MAX_STRIKES) { setResult('bot-win'); return }
    }

    setReveal(q.correct)
    setTimeout(() => {
      setReveal(null)
      const next = qIdx + 1
      if (next >= questions.length) { endByTime(myRem, botTimeBank); return }
      setQIdx(next)
      advance('bot', myRem, setPTB)
    }, REVEAL_MS)
  }

  function handlePlayerSkip() {
    if (turn !== 'player' || reveal || phase !== 'playing' || processingRef.current) return
    processingRef.current = true
    const myRem = Math.max(0, calcRem('player', playerTimeBank, turnStarted) - SKIP_PEN)
    if (myRem <= 0) { setResult('bot-win'); return }
    const next = qIdx + 1
    if (next >= questions.length) { endByTime(myRem, botTimeBank); return }
    setQIdx(next)
    advance('bot', myRem, setPTB)
  }

  function handleBotAction(answer, q) {
    const botRem    = calcRem('bot', botTimeBank, turnStarted)
    let newBS       = botStrikes

    if (answer === 'skip') {
      const afterSk = Math.max(0, botRem - SKIP_PEN)
      if (afterSk <= 0) { setResult('player-win'); return }
      const next = qIdx + 1
      if (next >= questions.length) { endByTime(playerTimeBank, afterSk); return }
      setQIdx(next)
      advance('player', afterSk, setBTB)
      return
    }

    if (answer !== q.correct) {
      newBS = botStrikes + 1
      setBS(newBS)
      if (newBS >= MAX_STRIKES) { setBTB(botRem); setResult('player-win'); return }
    }

    setReveal(q.correct)
    setTimeout(() => {
      setReveal(null)
      const next = qIdx + 1
      if (next >= questions.length) { endByTime(playerTimeBank, botRem); return }
      setQIdx(next)
      advance('player', botRem, setBTB)
    }, REVEAL_MS)
  }

  // ── Error ──
  if (phase === 'error') return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 px-4 text-center">
      <p className="text-red-400 font-bold">שגיאה בטעינת שאלות</p>
      <p className="text-gray-600 text-xs">{genErr}</p>
      <button onClick={() => onComplete(false)} className="text-[#a855f7] text-sm underline">סגור</button>
    </div>
  )

  // ── Loading ──
  if (phase === 'loading') return <DuelGenerating />

  // ── Result overlay ──
  if (result) {
    const won = result === 'player-win'
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center gap-5 py-10 px-4 text-center relative overflow-hidden">
        <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.06, 0.2, 0.06] }}
          transition={{ duration: 2.5, repeat: Infinity }}
          className={`absolute w-72 h-72 rounded-full blur-3xl pointer-events-none ${won ? 'bg-yellow-500' : 'bg-red-700'}`} />
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 14 }}
          className="text-7xl select-none relative z-10">
          {won ? '🏆' : '💀'}
        </motion.div>
        <h2 className={`text-4xl font-black relative z-10 ${won ? 'text-yellow-400' : 'text-red-400'}`}
          style={won ? { textShadow: '0 0 16px rgba(250,204,21,0.5)' } : {}}>
          {won ? 'ניצחת בקרב!' : 'הודחת!'}
        </h2>
        <p className="text-gray-400 text-sm relative z-10">
          {won ? 'הטריטוריה שלך עכשיו! 🗺️' : 'הניסיון הבא יצליח יותר'}
        </p>
        <div className="flex gap-6 relative z-10">
          {[
            { label: user?.displayName ?? 'אתה', time: timerDisplay.player, strikes: playerStrikes, isWin: won },
            { label: BOT_NAME, time: timerDisplay.bot, strikes: botStrikes, isWin: !won },
          ].map(p => (
            <div key={p.label} className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border ${p.isWin ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-[#1e1e2e]'}`}>
              <span className={`text-xs font-semibold ${p.isWin ? 'text-yellow-400' : 'text-gray-400'}`}>{p.label}</span>
              <span className="text-xs text-gray-500">{Math.ceil(p.time)}s</span>
              <DuelStrikes count={p.strikes} />
            </div>
          ))}
        </div>
        <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.93 }}
          onClick={() => onComplete(won)}
          className={`relative z-10 px-8 py-3 rounded-xl font-black text-white text-base transition-all ${
            won ? 'bg-yellow-500 shadow-[0_0_18px_rgba(234,179,8,0.4)]' : 'bg-[#a855f7] shadow-[0_0_18px_rgba(168,85,247,0.4)]'
          }`}>
          {won ? '🗺️ חזור ללוח' : '↩ חזור ללוח'}
        </motion.button>
      </motion.div>
    )
  }

  // ── Active duel ──
  const q        = questions[qIdx]
  const isMyTurn = turn === 'player'

  return (
    <div className="flex flex-col gap-3">
      {/* Duel header */}
      <div className="text-center">
        <p className="text-[#a855f7] font-black text-sm tracking-wide">
          ⚔️ דו-קרב על: <span className="text-white">{topic}</span>
          <span className="text-gray-500 font-normal"> · </span>
          <span className={`text-xs font-bold ${difficulty === 'קשה' ? 'text-red-400' : difficulty === 'בינוני' ? 'text-yellow-400' : 'text-green-400'}`}>
            {difficulty}
          </span>
        </p>
        <p className="text-gray-600 text-xs mt-0.5">שאלה {qIdx + 1}/{questions.length}</p>
      </div>

      {/* VS bar */}
      <div className="flex items-center justify-around bg-[#12121a] border border-[#1e1e2e] rounded-xl px-4 py-3">
        {[
          { key: 'player', label: user?.displayName ?? 'אתה', strikes: playerStrikes, time: timerDisplay.player },
          { key: 'bot',    label: BOT_NAME, strikes: botStrikes, time: timerDisplay.bot },
        ].map((p, i, arr) => (
          <React.Fragment key={p.key}>
            <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${turn === p.key ? 'opacity-100' : 'opacity-40'}`}>
              <div className="relative">
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-black ${
                  p.key === 'player' ? 'border-[#a855f7] text-[#a855f7]' : 'border-gray-600 text-gray-400'
                } bg-[#0a0a0f]`}>
                  {p.key === 'player' ? (user?.displayName?.[0]?.toUpperCase() ?? '?') : '🤖'}
                </div>
                {turn === p.key && (
                  <motion.span animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 0.85, repeat: Infinity }}
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#a855f7] border-2 border-[#0a0a0f]" />
                )}
              </div>
              <span className={`text-[10px] font-semibold max-w-[60px] truncate ${p.key === 'player' ? 'text-[#a855f7]' : 'text-gray-500'}`}>{p.label}</span>
              <DuelTimerRing secs={p.time} active={turn === p.key} px={52} />
              <DuelStrikes count={p.strikes} />
            </div>
            {i < arr.length - 1 && <span className="text-gray-700 font-black text-sm flex-shrink-0">VS</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Bot thinking indicator */}
      {botThinking && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center text-xs text-cyan-400 font-bold animate-pulse">הבוט חושב...</motion.p>
      )}
      {isMyTurn && !botThinking && !reveal && (
        <motion.p animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.3, repeat: Infinity }}
          className="text-center text-xs text-[#a855f7] font-bold">✨ התור שלך — ענה!</motion.p>
      )}

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div key={q.id}
          initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}
          className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <span className="inline-block text-xs text-[#a855f7] bg-purple-900/30 border border-purple-800 px-2 py-0.5 rounded-full mb-3">{q.category}</span>
          <p className="text-white font-bold text-sm leading-relaxed mb-4">{q.question}</p>
          <div className="grid grid-cols-2 gap-2">
            {q.options.map((opt, i) => {
              let cls = 'border-[#1e1e2e] bg-[#0a0a0f] text-gray-400 cursor-default'
              if (!reveal && isMyTurn && !botThinking) cls = 'border-[#1e1e2e] bg-[#0a0a0f] text-white hover:border-[#a855f7] hover:bg-purple-900/15 cursor-pointer'
              else if (reveal) {
                if (opt === reveal) cls = 'border-green-500 bg-green-900/25 text-green-300'
                else cls = 'border-[#1e1e2e] bg-[#0a0a0f] opacity-30 text-gray-600 cursor-default'
              }
              return (
                <motion.button key={`${qIdx}-${i}`}
                  onClick={() => isMyTurn && !reveal && !botThinking && handlePlayerAnswer(opt)}
                  whileHover={isMyTurn && !reveal && !botThinking ? { scale: 1.02 } : {}}
                  whileTap={isMyTurn && !reveal && !botThinking ? { scale: 0.97 } : {}}
                  className={`flex items-center gap-2 border-2 rounded-lg px-3 py-2.5 text-right text-xs font-medium transition-all ${cls}`}>
                  <span className="w-6 h-6 rounded-md bg-[#12121a] border border-[#1e1e2e] flex items-center justify-center text-[10px] font-black text-gray-500 flex-shrink-0">
                    {OPT_LABELS[i]}
                  </span>
                  <span className="flex-1 text-right leading-tight">{opt}</span>
                </motion.button>
              )
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      {isMyTurn && !reveal && !botThinking && (
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={handlePlayerSkip} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
          className="self-center border border-[#1e1e2e] text-gray-600 hover:border-red-500/60 hover:text-red-400 transition-all rounded-xl px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5">
          <span>⚡ דלג</span>
          <span className="text-red-500/50">−{SKIP_PEN}s</span>
        </motion.button>
      )}
    </div>
  )
}

// ─────────────────────────── Board main component ────────────────────────────

export default function Board({ user, onExit }) {
  const [cells,     setCells]     = useState(initBoard)
  const [attacking, setAttacking] = useState(null)  // { cellId, topic, difficulty }

  // Derive player cells and attackable cells
  const playerCellIds = useMemo(
    () => cells.filter(c => c.owner === PLAYER_ID).map(c => c.id),
    [cells]
  )

  const attackableCellIds = useMemo(() => {
    const s = new Set()
    playerCellIds.forEach(pid => {
      getAdjacentIds(pid).forEach(adj => {
        if (cells[adj].owner !== PLAYER_ID) s.add(adj)
      })
    })
    return s
  }, [playerCellIds, cells])

  const litCellIds = useMemo(
    () => new Set([...playerCellIds, ...attackableCellIds]),
    [playerCellIds, attackableCellIds]
  )

  const allCaptured = playerCellIds.length === GRID * GRID

  function handleCellClick(id) {
    if (!attackableCellIds.has(id)) return
    const cell = cells[id]
    setAttacking({ cellId: id, topic: cell.topic, difficulty: cell.difficulty })
  }

  function handleDuelComplete(won) {
    if (won && attacking) {
      setCells(prev => prev.map(c => {
        if (c.id !== attacking.cellId) return c
        return { ...c, owner: PLAYER_ID, ownerName: 'אתה', colorKey: 0 }
      }))
    }
    setAttacking(null)
  }

  // ── Victory screen ──
  if (allCaptured) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 text-center gap-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12 }}
          className="text-8xl select-none">
          👑
        </motion.div>
        <h1 className="text-4xl font-black text-yellow-400" style={{ textShadow: '0 0 20px rgba(250,204,21,0.5)' }}>
          כבשת את כל הזירה!
        </h1>
        <p className="text-gray-400 text-sm">25/25 טריטוריות שייכות לך</p>
        <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.93 }}
          onClick={onExit}
          className="bg-yellow-500 text-black font-black px-10 py-3 rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.4)]">
          חזרה ללובי
        </motion.button>
      </motion.div>
    )
  }

  const palPlayer = PALETTE[0]

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col" dir="rtl">

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] flex-shrink-0">
        <button onClick={onExit}
          className="text-gray-600 hover:text-red-400 text-xs transition-colors">
          ↩ לובי
        </button>
        <h1 className="text-lg font-black text-[#a855f7]" style={{ textShadow: '0 0 10px rgba(168,85,247,0.5)' }}>
          🗺️ כיבוש הזירה
        </h1>
        <span className="text-gray-600 text-xs">
          {playerCellIds.length}/{GRID * GRID} טריטוריות
        </span>
      </header>

      {/* Duel overlay (modal-style) */}
      <AnimatePresence>
        {attacking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#0a0a0f]/95 flex flex-col overflow-y-auto"
            style={{ direction: 'rtl' }}
          >
            <div className="flex-1 flex flex-col justify-center px-4 py-6 max-w-lg mx-auto w-full">
              <BoardDuel
                topic={attacking.topic}
                difficulty={attacking.difficulty}
                user={user}
                onComplete={handleDuelComplete}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Instructions */}
      <div className="px-4 py-2 text-center flex-shrink-0">
        <p className="text-gray-600 text-[11px]">
          {attackableCellIds.size > 0
            ? `${attackableCellIds.size} טריטוריות ניתנות לתקיפה · לחץ על משבצת מוארת`
            : 'אין טריטוריות שכנות לתקיפה'}
        </p>
      </div>

      {/* Grid */}
      <main className="flex-1 flex items-center justify-center p-3 sm:p-4">
        <div
          className="grid gap-1.5 sm:gap-2 w-full"
          style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`, maxWidth: 420 }}
        >
          {cells.map(cell => {
            const isPlayer     = cell.owner === PLAYER_ID
            const isAttackable = attackableCellIds.has(cell.id)
            const isLit        = litCellIds.has(cell.id)
            const pal          = PALETTE[cell.colorKey] ?? PALETTE[1]

            return (
              <motion.div
                key={cell.id}
                onClick={() => handleCellClick(cell.id)}
                whileHover={isAttackable ? { scale: 1.06, zIndex: 10 } : {}}
                whileTap={isAttackable ? { scale: 0.96 } : {}}
                animate={isAttackable ? {
                  boxShadow: [
                    `0 0 0px ${pal.glow}`,
                    `0 0 16px ${pal.glow}`,
                    `0 0 0px ${pal.glow}`,
                  ],
                } : {}}
                transition={isAttackable ? {
                  boxShadow: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
                } : {}}
                className="relative aspect-square rounded-xl flex flex-col items-center justify-between p-1.5 select-none"
                style={{
                  backgroundColor: pal.bg,
                  border: `2px solid ${isAttackable ? pal.border : isPlayer ? palPlayer.border : 'transparent'}`,
                  opacity: isLit ? 1 : 0.22,
                  cursor: isAttackable ? 'pointer' : 'default',
                  transition: 'opacity 0.3s, border-color 0.3s',
                }}
              >
                {/* Owner name */}
                <span className="text-white font-bold leading-tight text-center w-full"
                  style={{ fontSize: 'clamp(7px, 1.8vw, 11px)' }}>
                  {cell.ownerName}
                </span>

                {/* Topic */}
                <span className="text-white font-black text-center leading-tight w-full"
                  style={{ fontSize: 'clamp(8px, 2vw, 12px)' }}>
                  {cell.topic}
                </span>

                {/* Difficulty / owned badge */}
                <span className="text-white/60 text-center w-full truncate"
                  style={{ fontSize: 'clamp(6px, 1.5vw, 9px)' }}>
                  {isPlayer ? '⚔️ שלך' : cell.difficulty ? `בוט ${cell.difficulty}` : ''}
                </span>

                {/* Attackable glow ring */}
                {isAttackable && (
                  <motion.div
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ border: `2px solid ${pal.border}`, boxShadow: `inset 0 0 8px ${pal.glow}` }}
                  />
                )}
              </motion.div>
            )
          })}
        </div>
      </main>

      {/* Legend */}
      <footer className="px-4 py-2 border-t border-[#1e1e2e] flex items-center justify-center gap-4 flex-shrink-0">
        <span className="flex items-center gap-1 text-gray-600 text-[10px]">
          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: palPlayer.bg, border: `1px solid ${palPlayer.border}` }} />
          שלך
        </span>
        <span className="flex items-center gap-1 text-gray-600 text-[10px]">
          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: '#581c87', border: '1px solid #c084fc' }} />
          ניתן לתקיפה
        </span>
        <span className="flex items-center gap-1 text-gray-600 text-[10px]">
          <span className="w-3 h-3 rounded-sm opacity-25 flex-shrink-0" style={{ backgroundColor: '#1e1e2e' }} />
          מחוץ לטווח
        </span>
      </footer>
    </div>
  )
}
