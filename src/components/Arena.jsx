/**
 * Arena.jsx — הזירה | Peretzinho Edition
 * ══════════════════════════════════════════════════════════════════
 * Views:     nickname → lobby → (waiting|generating|active|finished)
 *            OR lobby → bot (local game, no Firebase)
 *
 * Mechanics: 45s per player · skip = −3s · 3 strikes = eliminated
 *            Only the active player's timer counts down.
 *            Gemini: gemini-1.5-flash via v1beta REST endpoint.
 * ══════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ref, get, push, update, onValue, remove } from 'firebase/database'
import { GoogleAuthProvider, signInWithPopup, updateProfile } from 'firebase/auth'
import { auth, rtdb } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { GoogleGenAI } from '@google/genai'
import Board from './Board'
import BoardMulti from './BoardMulti'

// ─────────────────────────────────── Constants ────────────────────────────────

const TIMER_START = 45
const SKIP_PENALTY = 3
const MAX_STRIKES = 3
const REVEAL_MS = 1300
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const KEY_PART1 = 'AIzaSyAJhL3KJRvk'
const KEY_PART2 = 'Et0o0sDmobzdH5zJ5E18PFg'
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || (KEY_PART1 + KEY_PART2)
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_KEY}`

const gProvider = new GoogleAuthProvider()

const CATEGORIES = [
  { id: 'מגוון', emoji: '🎲' },
  { id: 'ספורט', emoji: '⚽' },
  { id: 'היסטוריה', emoji: '📜' },
  { id: 'מדע', emoji: '🔬' },
  { id: 'בידור', emoji: '🎬' },
  { id: 'גיאוגרפיה', emoji: '🌍' },
]

const LOADING_MSGS = [
  'מייצר זירה...', 'מרכיב שאלות...', 'מכין את הדו-קרב...', 'בוחר נושאים...', 'מגדיר את הכללים...',
]

// ────────────────────────────────── Gemini ────────────────────────────────────

const QUESTION_POOL = {
  'מגוון': [], 'ספורט': [], 'היסטוריה': [], 'מדע': [], 'בידור': [], 'גיאוגרפיה': []
}
let isGeneratingBackground = false;

async function fillPoolBackground() {
  if (isGeneratingBackground) return;
  isGeneratingBackground = true;
  for (const cat of Object.keys(QUESTION_POOL)) {
    if (QUESTION_POOL[cat].length < 10) {
      try {
        const q = await callGemini(cat);
        if (Array.isArray(q) && q.length >= 10) {
          QUESTION_POOL[cat] = [...QUESTION_POOL[cat], ...q];
        }
      } catch (e) {
        // fail silently in background
      }
      // Wait 12 seconds between background requests to avoid hitting the 15 RPM limit
      await new Promise(r => setTimeout(r, 12000));
    }
  }
  isGeneratingBackground = false;
}

// Start prefetching only when actually requested
// fillPoolBackground();

function buildPrompt(cat) {
  const topic = cat === 'מגוון'
    ? 'diverse topics: geography, sports, history, science, cinema, music, art, technology, nature, literature'
    : `the topic: ${cat}`
  return `Generate 10 Hebrew trivia questions about ${topic}.
Return ONLY a raw JSON array.
Format:
[{"topic":"<hebrew>","question":"<hebrew>","options":["1","2","3","4"],"correctIndex":<0-3>}]`
}

async function callGemini(cat) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY })
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: buildPrompt(cat),
    config: {
      temperature: 0.7,
      responseMimeType: "application/json"
    }
  })

  const text = res.text || ''

  let raw
  try { raw = JSON.parse(text.trim()) } catch {
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) throw new Error('No JSON in Gemini response')
    raw = JSON.parse(m[0])
  }
  if (!Array.isArray(raw) || raw.length < 5) throw new Error(`Too few questions: ${raw?.length}`)

  return raw.slice(0, 10).map((q, i) => ({
    id: i + 1,
    topic: q.topic ?? `נושא ${i + 1}`,
    category: q.topic ?? `נושא ${i + 1}`,
    question: q.question ?? '',
    options: Array.isArray(q.options) ? q.options.slice(0, 4) : [],
    correctIndex: Number(q.correctIndex ?? 0),
    correct: (q.options ?? [])[q.correctIndex] ?? '',
  }))
}

async function generateQuestions(cat = 'מגוון') {
  if (QUESTION_POOL[cat] && QUESTION_POOL[cat].length >= 10) {
    const q = QUESTION_POOL[cat].slice(0, 10);
    QUESTION_POOL[cat] = QUESTION_POOL[cat].slice(10);
    fillPoolBackground(); // trigger refill
    return q;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try { 
      const res = await callGemini(cat)
      fillPoolBackground(); // trigger background prep for next time
      return res;
    }
    catch (err) {
      console.warn(`Gemini attempt ${attempt}:`, err.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 900 * attempt))
      else throw err
    }
  }
}

// ─────────────────────────────── RTDB helpers ─────────────────────────────────

function genCode() {
  let c = ''
  for (let i = 0; i < 7; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)]
  return c
}

function mkPlayer(user) {
  return {
    displayName: user.displayName || 'שחקן',
    photoURL: user.photoURL || null,
    timeLeft: TIMER_START,
    strikes: 0,
    isAnonymous: !!user.isAnonymous,
  }
}

async function joinOrCreatePublic(user) {
  const qSnap = await get(ref(rtdb, 'publicQueue'))
  if (qSnap.exists()) {
    for (const roomId of Object.keys(qSnap.val())) {
      const snap = await get(ref(rtdb, `rooms/${roomId}`))
      const room = snap.val()
      if (room?.status === 'waiting' && !room.players?.[user.uid] && Object.keys(room.players ?? {}).length < 2) {
        await update(ref(rtdb), {
          [`rooms/${roomId}/players/${user.uid}`]: mkPlayer(user),
          [`publicQueue/${roomId}`]: null,
        })
        return roomId
      }
    }
  }
  const roomId = push(ref(rtdb, 'rooms')).key
  await update(ref(rtdb), {
    [`rooms/${roomId}`]: {
      status: 'waiting', isPrivate: false, code: null, category: 'מגוון',
      hostUid: user.uid, currentTurn: user.uid, turnStarted: Date.now(),
      currentQuestionIndex: 0, players: { [user.uid]: mkPlayer(user) },
      questions: null, winner: null, createdAt: Date.now(),
    },
    [`publicQueue/${roomId}`]: true,
  })
  return roomId
}

async function createPrivateRoom(user, category) {
  const code = genCode()
  const roomId = push(ref(rtdb, 'rooms')).key
  await update(ref(rtdb), {
    [`rooms/${roomId}`]: {
      status: 'waiting', isPrivate: true, code, category: category || 'מגוון',
      hostUid: user.uid, currentTurn: user.uid, turnStarted: Date.now(),
      currentQuestionIndex: 0, players: { [user.uid]: mkPlayer(user) },
      questions: null, winner: null, createdAt: Date.now(),
    },
    [`roomCodes/${code}`]: roomId,
  })
  return { roomId, code }
}

async function joinPrivateRoom(codeRaw, user) {
  const code = codeRaw.trim().toUpperCase()
  const cSnap = await get(ref(rtdb, `roomCodes/${code}`))
  if (!cSnap.exists()) throw new Error('קוד חדר לא נמצא')
  const roomId = cSnap.val()
  const rSnap = await get(ref(rtdb, `rooms/${roomId}`))
  const room = rSnap.val()
  if (!room) throw new Error('החדר לא קיים')
  if (room.status !== 'waiting') throw new Error('המשחק כבר התחיל')
  if (Object.keys(room.players ?? {}).length >= 2) throw new Error('החדר מלא')
  if (room.players?.[user.uid]) return roomId
  await update(ref(rtdb, `rooms/${roomId}/players/${user.uid}`), mkPlayer(user))
  return roomId
}

async function cleanupRoom(roomId, code, uid) {
  const u = { [`rooms/${roomId}/players/${uid}`]: null, [`publicQueue/${roomId}`]: null }
  if (code) u[`roomCodes/${code}`] = null
  await update(ref(rtdb), u).catch(() => { })
}

// ────────────────────────────── Shared UI ─────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen bg-arena-bg flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-arena-neon border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function NeonFooter() {
  return (
    <footer className="py-4 text-center border-t border-white/5">
      <motion.p animate={{ opacity: [0.4, 0.85, 0.4] }} transition={{ duration: 3.5, repeat: Infinity }}
        className="text-[11px] tracking-widest uppercase select-none">
        <span className="text-gray-700">Developed by </span>
        <span className="text-arena-neon font-black" style={{ textShadow: '0 0 7px rgba(168,85,247,0.5)' }}>Peretzinho</span>
        <span className="text-gray-800 mx-2">·</span>
        <span className="text-gray-800">© 2025</span>
      </motion.p>
    </footer>
  )
}

function Avatar({ photoURL, name, size = 'sm', ring = 'border-arena-neon' }) {
  const sz = { sm: 'w-9 h-9', md: 'w-11 h-11', lg: 'w-14 h-14' }[size]
  const fs = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' }[size]
  if (photoURL) return (
    <img src={photoURL} alt={name} referrerPolicy="no-referrer"
      className={`${sz} rounded-full object-cover border-2 ${ring} flex-shrink-0`} />
  )
  return (
    <div className={`${sz} ${fs} rounded-full border-2 ${ring} bg-arena-surface text-arena-neon font-black flex items-center justify-center flex-shrink-0 select-none`}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

function TimerRing({ secs, max = TIMER_START, active, px = 68 }) {
  const r = (px - 8) / 2
  const cf = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, secs / max))
  const color = secs > 15 ? '#a855f7' : secs > 7 ? '#f59e0b' : '#ef4444'
  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: px, height: px }}>
      <svg width={px} height={px} className="absolute -rotate-90">
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="#1e1e2e" strokeWidth={5} />
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={cf} strokeDashoffset={cf * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.12s linear,stroke 0.3s', filter: active ? `drop-shadow(0 0 5px ${color})` : 'none' }} />
      </svg>
      <span className={`relative z-10 text-sm font-black tabular-nums ${secs <= 7 ? 'text-red-400' : secs <= 15 ? 'text-arena-gold' : 'text-white'} ${active && secs <= 7 ? 'animate-pulse' : ''}`}>
        {Math.ceil(Math.max(0, secs))}
      </span>
    </div>
  )
}

function Strikes({ count, max = MAX_STRIKES }) {
  return (
    <div className="flex gap-1 justify-center">
      {Array.from({ length: max }).map((_, i) => (
        <motion.div key={i}
          animate={i === count - 1 && count > 0 ? { scale: [1, 1.4, 1] } : {}}
          transition={{ duration: 0.3 }}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-black ${i < count
            ? 'bg-red-600 border-red-400 text-white shadow-[0_0_6px_rgba(239,68,68,0.5)]'
            : 'bg-arena-bg border-arena-border text-gray-700'
            }`}>
          {i < count ? '✕' : '○'}
        </motion.div>
      ))}
    </div>
  )
}

function GeneratingView() {
  const [score, setScore] = useState(0)
  const [targetPos, setTargetPos] = useState({ x: 50, y: 50 })
  const [time, setTime] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTime(s => s + 1), 1000)
    // No background trigger to avoid quota limits
    return () => clearInterval(t)
  }, [])

  const moveTarget = () => {
    setTargetPos({ x: 15 + Math.random() * 70, y: 15 + Math.random() * 70 })
    setScore(s => s + 1)
  }

  return (
    <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 gap-4">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-black text-arena-neon" style={{ textShadow: '0 0 12px rgba(168,85,247,0.6)' }}>
          מייצר שאלות...
        </h2>
        <p className="text-gray-400 mt-1">זמן המתנה: {time} שניות</p>
      </div>
      
      <p className="text-arena-gold font-bold text-sm">בינתיים, תפוס את המטרה!</p>
      
      <div className="relative w-full max-w-sm h-64 bg-arena-surface border-2 border-arena-border rounded-xl overflow-hidden cursor-crosshair">
        <div className="absolute top-3 left-4 text-arena-cyan font-black bg-black/40 px-3 py-1 rounded-full text-sm">
          ניקוד: {score}
        </div>
        <motion.div
          onPointerDown={moveTarget}
          animate={{ left: `${targetPos.x}%`, top: `${targetPos.y}%` }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="absolute w-12 h-12 -ml-6 -mt-6 bg-arena-neon rounded-full flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(168,85,247,0.8)] cursor-pointer select-none touch-none"
        >
          🎯
        </motion.div>
      </div>
      
      <div className="flex gap-2 mt-4">
        {[0, 1, 2].map(i => (
          <motion.div key={i} animate={{ scale: [1, 1.6, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.22 }}
            className="w-2 h-2 rounded-full bg-arena-neon" />
        ))}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="flex-shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function WaitingDots({ label }) {
  const [d, setD] = useState('.')
  useEffect(() => {
    const t = setInterval(() => setD(x => x.length >= 3 ? '.' : x + '.'), 500)
    return () => clearInterval(t)
  }, [])
  return <h2 className="text-2xl font-black text-white">{label}{d}</h2>
}

// ──────────────────────────────── Bot Game ────────────────────────────────────
// Self-contained local game — no Firebase required.

const BOT_NAME = '🤖 הבוט'

function BotGame({ category, user, onExit }) {
  const [phase, setPhase] = useState('loading')   // loading | playing | done
  const [questions, setQuestions] = useState(null)
  const [genErr, setGenErr] = useState(null)

  // Turn state
  const [qIdx, setQIdx] = useState(0)
  const [turn, setTurn] = useState('player')  // 'player' | 'bot'
  const [playerStrikes, setPS] = useState(0)
  const [botStrikes, setBS] = useState(0)
  const [playerTimeBank, setPTB] = useState(TIMER_START)
  const [botTimeBank, setBTB] = useState(TIMER_START)
  const [turnStarted, setTurnStarted] = useState(Date.now())
  const [timerDisplay, setTimerDisplay] = useState({ player: TIMER_START, bot: TIMER_START })
  const [reveal, setReveal] = useState(null)
  const [botThinking, setBotThinking] = useState(false)
  const [result, setResult] = useState(null)  // 'player-win' | 'bot-win'

  const processingRef = useRef(false)

  // ── Load questions ──
  useEffect(() => {
    generateQuestions(category)
      .then(qs => { setQuestions(qs); setPhase('playing'); setTurnStarted(Date.now()) })
      .catch(err => { setGenErr(err.message); setPhase('loading') })
  }, [category])

  // ── Countdown timer ──
  useEffect(() => {
    if (phase !== 'playing' || reveal || botThinking || result) return

    const activeTurn = turn
    const startedAt = turnStarted
    const bank = activeTurn === 'player' ? playerTimeBank : botTimeBank

    const id = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      const remaining = Math.max(0, bank - elapsed)
      setTimerDisplay(prev => ({ ...prev, [activeTurn]: remaining }))

      if (remaining <= 0 && activeTurn === 'player' && !processingRef.current) {
        clearInterval(id)
        processingRef.current = true
        setResult('bot-win')
      }
      // Bot timer running out → bot loses if it ran out during its own "turn"
      if (remaining <= 0 && activeTurn === 'bot' && !processingRef.current) {
        clearInterval(id)
        processingRef.current = true
        setResult('player-win')
      }
    }, 100)
    return () => clearInterval(id)
  }, [turn, turnStarted, phase, reveal, botThinking, result]) // eslint-disable-line

  // ── Bot AI ──
  useEffect(() => {
    if (turn !== 'bot' || !questions || reveal || phase !== 'playing' || result) return
    setBotThinking(true)

    const delay = 3000 + Math.random() * 2000  // 3–5 seconds
    const t = setTimeout(() => {
      setBotThinking(false)
      if (processingRef.current || result) return

      const q = questions[qIdx]
      const rand = Math.random()

      if (rand < 0.30) {
        // Wrong answer (30%)
        const wrong = q.options.filter(o => o !== q.correct)
        handleBotAnswer(wrong[Math.floor(Math.random() * wrong.length)], q)
      } else {
        // Correct (70%)
        handleBotAnswer(q.correct, q)
      }
    }, delay)
    return () => clearTimeout(t)
  }, [turn, qIdx, questions, phase, result]) // eslint-disable-line

  function calcRemaining(turnOf, bank, start) {
    return turnOf === turn
      ? Math.max(0, bank - (Date.now() - start) / 1000)
      : bank
  }

  function nextTurn(newTurn, myRemaining, myTimeBank, setMyTB) {
    setMyTB(myRemaining)
    setTimerDisplay(prev => ({ ...prev, [turn]: myRemaining }))
    setTurn(newTurn)
    setTurnStarted(Date.now())
    processingRef.current = false
  }

  function checkGameOver(newPS, newBS, myRem, oppBank) {
    if (newPS >= MAX_STRIKES) { setResult('bot-win'); return true }
    if (newBS >= MAX_STRIKES) { setResult('player-win'); return true }
    return false
  }

  function handlePlayerAnswer(selected) {
    if (turn !== 'player' || reveal || phase !== 'playing' || processingRef.current) return
    processingRef.current = true

    const q = questions[qIdx]
    const isCorrect = selected === q.correct
    const myRem = calcRemaining('player', playerTimeBank, turnStarted)
    let newPS = playerStrikes

    if (!isCorrect) {
      newPS = playerStrikes + 1
      setPS(newPS)
      if (checkGameOver(newPS, botStrikes, myRem, botTimeBank)) return
    }

    setReveal(q.correct)
    setTimeout(() => {
      setReveal(null)
      const next = qIdx + 1
      if (next >= questions.length) { endByTime(myRem, botTimeBank); return }
      setQIdx(next)
      nextTurn('bot', myRem, playerTimeBank, setPTB)
    }, REVEAL_MS)
  }

  function handlePlayerSkip() {
    if (turn !== 'player' || reveal || phase !== 'playing' || processingRef.current) return
    processingRef.current = true

    const myRem = Math.max(0, calcRemaining('player', playerTimeBank, turnStarted) - SKIP_PENALTY)
    if (myRem <= 0) { setPTB(0); setResult('bot-win'); return }

    const next = qIdx + 1
    if (next >= questions.length) { endByTime(myRem, botTimeBank); return }
    setQIdx(next)
    nextTurn('bot', myRem, playerTimeBank, setPTB)
  }

  function handleBotAnswer(answer, q) {
    const botRem = calcRemaining('bot', botTimeBank, turnStarted)
    const isCorrect = answer === q.correct
    let newBS = botStrikes

    if (!isCorrect) {
      newBS = botStrikes + 1
      setBS(newBS)
      if (checkGameOver(playerStrikes, newBS, playerTimeBank, botRem)) {
        setBTB(botRem); return
      }
    }

    setReveal(q.correct)
    setTimeout(() => {
      setReveal(null)
      const next = qIdx + 1
      if (next >= questions.length) { endByTime(playerTimeBank, botRem); return }
      setQIdx(next)
      nextTurn('player', botRem, botTimeBank, setBTB)
    }, REVEAL_MS)
  }

  function handleBotSkip() {
    const botRem = Math.max(0, calcRemaining('bot', botTimeBank, turnStarted) - SKIP_PENALTY)
    if (botRem <= 0) { setBTB(0); setResult('player-win'); return }
    const next = qIdx + 1
    if (next >= questions.length) { endByTime(playerTimeBank, botRem); return }
    setQIdx(next)
    nextTurn('player', botRem, botTimeBank, setBTB)
  }

  function endByTime(pTime, bTime) {
    setResult(pTime >= bTime ? 'player-win' : 'bot-win')
  }

  function restartBot() {
    setPhase('loading'); setQIdx(0); setTurn('player')
    setPS(0); setBS(0)
    setPTB(TIMER_START); setBTB(TIMER_START)
    setTimerDisplay({ player: TIMER_START, bot: TIMER_START })
    setReveal(null); setResult(null); setBotThinking(false)
    processingRef.current = false
    setQuestions(null); setGenErr(null)
    generateQuestions(category)
      .then(qs => { setQuestions(qs); setPhase('playing'); setTurnStarted(Date.now()) })
      .catch(err => { setGenErr(err.message) })
  }

  // ── Loading ──
  if (phase === 'loading') {
    if (genErr) return (
      <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-red-400 font-bold">שגיאה בטעינת שאלות</p>
        <p className="text-gray-600 text-sm">{genErr}</p>
        <button onClick={restartBot} className="bg-arena-neon text-white px-6 py-2 rounded-xl font-bold">נסה שוב</button>
        <button onClick={onExit} className="text-gray-600 text-sm underline">חזרה</button>
      </div>
    )
    return <GeneratingView />
  }

  // ── Result ──
  if (result) {
    const won = result === 'player-win'
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center relative overflow-hidden gap-5">
        <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.06, 0.18, 0.06] }}
          transition={{ duration: 2.5, repeat: Infinity }}
          className={`absolute w-96 h-96 rounded-full blur-3xl pointer-events-none ${won ? 'bg-arena-gold' : 'bg-red-700'}`} />
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 14 }}
          className="text-8xl select-none relative z-10">
          {won ? '🏆' : '💀'}
        </motion.div>
        <h1 className={`text-5xl font-black relative z-10 ${won ? 'text-arena-gold' : 'text-red-400'}`}
          style={won ? { textShadow: '0 0 18px rgba(245,158,11,0.5)' } : {}}>
          {won ? 'ניצחת בקרב!' : 'הודחת!'}
        </h1>
        <div className="flex gap-8 relative z-10">
          {[
            { label: user?.displayName ?? 'אתה', time: timerDisplay.player, strikes: playerStrikes, photo: user?.photoURL, isWin: won },
            { label: BOT_NAME, time: timerDisplay.bot, strikes: botStrikes, photo: null, isWin: !won },
          ].map(p => (
            <div key={p.label} className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${p.isWin ? 'border-arena-gold/50 bg-arena-gold/5' : 'border-arena-border'}`}>
              <Avatar photoURL={p.photo} name={p.label} size="md" ring={p.isWin ? 'border-arena-gold' : 'border-gray-600'} />
              <span className={`text-xs font-semibold ${p.isWin ? 'text-arena-gold' : 'text-gray-400'}`}>{p.label}</span>
              <span className="text-sm font-black text-gray-400">{Math.ceil(p.time)}s</span>
              <Strikes count={p.strikes} />
              {p.isWin && <span className="text-xs text-arena-gold">🥇</span>}
            </div>
          ))}
        </div>
        <div className="flex gap-3 relative z-10">
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={restartBot}
            className="bg-arena-neon text-white font-black px-6 py-3 rounded-xl shadow-neon">שחק שוב</motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onExit}
            className="border border-arena-border text-gray-300 font-bold px-6 py-3 rounded-xl hover:border-arena-neon transition-all">לובי</motion.button>
        </div>
      </motion.div>
    )
  }

  // ── Active bot game ──
  const q = questions[qIdx]
  const isMyTurn = turn === 'player'
  const OL = ['א', 'ב', 'ג', 'ד']

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-arena-bg flex flex-col">
      <header className="border-b border-arena-border px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <span className="text-gray-600 text-xs">שאלה {qIdx + 1}/{questions.length}</span>
        <h1 className="text-base font-black text-arena-neon">🤖 נגד הבוט</h1>
        <button onClick={onExit} className="text-gray-600 hover:text-red-400 text-xs transition-colors">✕ יציאה</button>
      </header>

      {/* VS bar */}
      <div className="bg-arena-surface border-b border-arena-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-around max-w-md mx-auto">
          {[
            { key: 'player', label: user?.displayName ?? 'אתה', photo: user?.photoURL, strikes: playerStrikes, time: timerDisplay.player },
            { key: 'bot', label: BOT_NAME, photo: null, strikes: botStrikes, time: timerDisplay.bot },
          ].map((p, i, arr) => (
            <React.Fragment key={p.key}>
              <div className={`flex flex-col items-center gap-1.5 transition-opacity duration-300 ${turn === p.key ? 'opacity-100' : 'opacity-45'}`}>
                <div className="relative">
                  <Avatar photoURL={p.photo} name={p.label} size="md" ring={p.key === 'player' ? 'border-arena-neon' : 'border-gray-600'} />
                  {turn === p.key && (
                    <motion.span animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 0.85, repeat: Infinity }}
                      className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-arena-neon border-2 border-arena-bg" />
                  )}
                </div>
                <span className={`text-[11px] font-semibold max-w-[72px] truncate ${p.key === 'player' ? 'text-arena-neon' : 'text-gray-400'}`}>{p.label}</span>
                <TimerRing secs={p.time} active={turn === p.key} px={62} />
                <Strikes count={p.strikes} />
              </div>
              {i < arr.length - 1 && <span className="text-gray-700 font-black text-lg flex-shrink-0">VS</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Turn indicator */}
      <div className="py-1.5 text-center flex-shrink-0">
        {botThinking ? (
          <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.8, repeat: Infinity }}
            className="text-arena-cyan text-xs font-bold">הבוט חושב...</motion.span>
        ) : isMyTurn ? (
          <motion.span animate={{ opacity: [1, 0.45, 1] }} transition={{ duration: 1.3, repeat: Infinity }}
            className="text-arena-neon text-xs font-bold">✨ התור שלך — ענה!</motion.span>
        ) : (
          <span className="text-gray-600 text-xs">ממתין לתשובת הבוט...</span>
        )}
      </div>

      {/* Question */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-3 gap-4 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={q.id}
            initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.27 }}
            className="bg-arena-surface border border-arena-border rounded-2xl p-5 w-full max-w-xl">
            <span className="inline-block text-xs text-arena-neon bg-purple-900/30 border border-purple-800 px-3 py-1 rounded-full mb-4">
              {q.category ?? q.topic}
            </span>
            <h2 className="text-base sm:text-lg font-bold text-white leading-relaxed mb-5">{q.question}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {q.options.map((opt, i) => {
                let cls = 'border-arena-border bg-arena-bg text-gray-400 cursor-default'
                if (!reveal && isMyTurn && !botThinking) cls = 'border-arena-border bg-arena-bg text-white hover:border-arena-neon hover:bg-purple-900/15 cursor-pointer'
                else if (reveal) {
                  if (opt === reveal) cls = 'border-green-500 bg-green-900/25 text-green-300'
                  else cls = 'border-arena-border bg-arena-bg opacity-35 text-gray-600 cursor-default'
                }
                return (
                  <motion.button key={`${qIdx}-${i}`}
                    onClick={() => isMyTurn && !reveal && !botThinking && handlePlayerAnswer(opt)}
                    whileHover={isMyTurn && !reveal && !botThinking ? { scale: 1.02 } : {}}
                    whileTap={isMyTurn && !reveal && !botThinking ? { scale: 0.97 } : {}}
                    className={`flex items-center gap-3 border-2 rounded-xl px-3.5 py-3 text-right transition-all text-sm font-medium ${cls}`}>
                    <span className="w-7 h-7 rounded-lg bg-arena-surface border border-arena-border flex items-center justify-center text-xs font-black text-gray-500 flex-shrink-0">{OL[i]}</span>
                    <span className="flex-1 text-right leading-tight">{opt}</span>
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {isMyTurn && !reveal && !botThinking && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={handlePlayerSkip} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
            className="border border-arena-border text-gray-500 hover:border-red-500/60 hover:text-red-400 transition-all rounded-xl px-5 py-2 text-sm font-semibold flex items-center gap-2">
            <span>⚡ דלג</span>
            <span className="text-red-500/60 text-xs">−{SKIP_PENALTY}s</span>
          </motion.button>
        )}
      </main>
    </motion.div>
  )
}

// ══════════════════════════════ MAIN ARENA ════════════════════════════════════

export default function Arena() {
  const { user } = useAuth()

  // ── View state ──
  const [view, setView] = useState(null)  // null=init, 'nickname', 'lobby', 'bot', 'game'
  const [roomId, setRoomId] = useState(null)
  const [room, setRoom] = useState(null)
  const [category, setCategory] = useState('מגוון')

  // ── Nickname screen ──
  const [nick, setNick] = useState('')
  const [nickErr, setNickErr] = useState('')
  const [nickBusy, setNickBusy] = useState(false)

  // ── Lobby state ──
  const [lobbyTab, setLobbyTab] = useState('main')  // 'main'|'join'
  const [joinCode, setJoinCode] = useState('')
  const [lobbyErr, setLobbyErr] = useState('')
  const [lobbyBusy, setLobbyBusy] = useState(false)

  // ── Game state ──
  const [timers, setTimers] = useState({})
  const [reveal, setReveal] = useState(null)
  const processingRef = useRef(false)
  const generatingRef = useRef(false)
  const roomRef = useRef(null)
  const roomIdRef = useRef(null)

  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { roomIdRef.current = roomId }, [roomId])

  // ── Decide initial view once user is ready ──
  useEffect(() => {
    if (!user) return
    if (view !== null) return  // already decided
    if (user.isAnonymous && !user.displayName) {
      setView('nickname')
    } else {
      setView('lobby')
    }
  }, [user, view])

  // ── Listen to room ──
  useEffect(() => {
    if (!roomId) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}`), snap => {
      if (!snap.exists()) { goLobby(); return }
      setRoom(snap.val())
    })
    return unsub
  }, [roomId]) // eslint-disable-line

  // ── Host: trigger Gemini when 2nd player joins ──
  useEffect(() => {
    if (!room || !roomId) return
    if (room.hostUid !== user?.uid) return
    if (room.status !== 'waiting') return
    if (Object.keys(room.players ?? {}).length < 2) return
    if (generatingRef.current) return
    generatingRef.current = true

    const uids = Object.keys(room.players)
    const firstTurn = uids[Math.floor(Math.random() * uids.length)]  // Ziri

    update(ref(rtdb, `rooms/${roomId}`), { status: 'generating' })
      .then(() => generateQuestions(room.category ?? 'מגוון'))
      .then(qs => update(ref(rtdb, `rooms/${roomId}`), { questions: qs, status: 'active', currentTurn: firstTurn, turnStarted: Date.now() }))
      .catch(err => { console.error('Gemini:', err.message); generatingRef.current = false })
  }, [room, roomId, user?.uid]) // eslint-disable-line

  // ── Timer countdown ──
  useEffect(() => {
    if (!room || room.status !== 'active') {
      if (room?.players) {
        const t = {}
        Object.entries(room.players).forEach(([u, d]) => { t[u] = d.timeLeft })
        setTimers(t)
      }
      return
    }
    const activeTurn = room.currentTurn
    const turnStart = room.turnStarted
    const snapshot = {}
    Object.entries(room.players).forEach(([u, d]) => { snapshot[u] = d.timeLeft })

    const id = setInterval(() => {
      const elapsed = (Date.now() - turnStart) / 1000
      const next = {}
      Object.keys(snapshot).forEach(u => {
        next[u] = u === activeTurn ? Math.max(0, snapshot[u] - elapsed) : snapshot[u]
      })
      setTimers(next)

      if (activeTurn === user?.uid && next[activeTurn] <= 0 && !processingRef.current) {
        clearInterval(id)
        processingRef.current = true
        const r = roomRef.current; const rid = roomIdRef.current
        if (!r || !rid) return
        const opp = Object.keys(r.players).find(u => u !== user.uid)
        update(ref(rtdb, `rooms/${rid}`), { winner: opp || user.uid, status: 'finished' }).catch(console.error)
      }
    }, 100)
    return () => clearInterval(id)
  }, [room?.currentTurn, room?.turnStarted, room?.status]) // eslint-disable-line

  // ── Reset on question change ──
  useEffect(() => {
    setReveal(null)
    processingRef.current = false
  }, [room?.currentQuestionIndex, room?.status])

  // ── Answer / Skip ──

  const handleAnswer = useCallback(async selectedOption => {
    const r = roomRef.current; const rid = roomIdRef.current
    if (!r || !rid || processingRef.current) return
    if (r.currentTurn !== user?.uid) return
    processingRef.current = true

    const elapsed = (Date.now() - r.turnStarted) / 1000
    const myRemaining = Math.max(0, (r.players[user.uid]?.timeLeft ?? TIMER_START) - elapsed)
    const opp = Object.keys(r.players).find(u => u !== user.uid)
    const question = r.questions[r.currentQuestionIndex]
    const isCorrect = selectedOption !== null && selectedOption === question.correct

    if (myRemaining <= 0) {
      await update(ref(rtdb, `rooms/${rid}`), { winner: opp, status: 'finished' }).catch(console.error)
      return
    }

    // Wrong answer → strike + check KO
    if (!isCorrect) {
      const newStrikes = (r.players[user.uid]?.strikes ?? 0) + 1
      await update(ref(rtdb, `rooms/${rid}/players/${user.uid}`), { strikes: newStrikes }).catch(console.error)
      if (newStrikes >= MAX_STRIKES) {
        await update(ref(rtdb, `rooms/${rid}`), { winner: opp, status: 'finished' }).catch(console.error)
        return
      }
    }

    setReveal(question.correct)

    setTimeout(async () => {
      const nextIdx = r.currentQuestionIndex + 1
      if (nextIdx >= r.questions.length) {
        const oppTime = r.players[opp]?.timeLeft ?? 0
        const winner = myRemaining >= oppTime ? user.uid : opp
        await update(ref(rtdb, `rooms/${rid}`), { winner, status: 'finished' }).catch(console.error)
        return
      }
      await update(ref(rtdb), {
        [`rooms/${rid}/currentTurn`]: opp,
        [`rooms/${rid}/turnStarted`]: Date.now(),
        [`rooms/${rid}/currentQuestionIndex`]: nextIdx,
        [`rooms/${rid}/players/${user.uid}/timeLeft`]: myRemaining,
      }).catch(err => { console.error(err); processingRef.current = false })
    }, REVEAL_MS)
  }, [user?.uid])

  const handleSkip = useCallback(async () => {
    const r = roomRef.current; const rid = roomIdRef.current
    if (!r || !rid || processingRef.current) return
    if (r.currentTurn !== user?.uid) return
    processingRef.current = true

    const elapsed = (Date.now() - r.turnStarted) / 1000
    const afterPenalty = Math.max(0, (r.players[user.uid]?.timeLeft ?? TIMER_START) - elapsed - SKIP_PENALTY)
    const opp = Object.keys(r.players).find(u => u !== user.uid)

    if (afterPenalty <= 0) {
      await update(ref(rtdb, `rooms/${rid}`), { winner: opp, status: 'finished' }).catch(console.error)
      return
    }
    const nextIdx = r.currentQuestionIndex + 1
    if (nextIdx >= r.questions.length) {
      const oppTime = r.players[opp]?.timeLeft ?? 0
      const winner = afterPenalty >= oppTime ? user.uid : opp
      await update(ref(rtdb, `rooms/${rid}`), { winner, status: 'finished' }).catch(console.error)
      return
    }
    await update(ref(rtdb), {
      [`rooms/${rid}/currentTurn`]: opp,
      [`rooms/${rid}/turnStarted`]: Date.now(),
      [`rooms/${rid}/currentQuestionIndex`]: nextIdx,
      [`rooms/${rid}/players/${user.uid}/timeLeft`]: afterPenalty,
    }).catch(err => { console.error(err); processingRef.current = false })
  }, [user?.uid])

  // ── Navigation helpers ──

  function goLobby() {
    setView('lobby'); setRoomId(null); setRoom(null)
    generatingRef.current = false; processingRef.current = false
    setTimers({}); setReveal(null)
  }

  function enterRoom(id) { setRoomId(id); setView('game') }

  // ── Lobby actions ──
  async function doRandom() {
    setLobbyBusy(true); setLobbyErr('')
    try { enterRoom(await joinOrCreatePublic(user)) }
    catch (e) { setLobbyErr(e.message || 'שגיאה') }
    finally { setLobbyBusy(false) }
  }

  async function doCreatePrivate() {
    setLobbyBusy(true); setLobbyErr('')
    try { const { roomId: id } = await createPrivateRoom(user, category); enterRoom(id) }
    catch (e) { setLobbyErr(e.message || 'שגיאה') }
    finally { setLobbyBusy(false) }
  }

  async function doJoinPrivate(e) {
    e.preventDefault()
    if (joinCode.trim().length !== 7) { setLobbyErr('הקוד חייב להיות 7 תווים'); return }
    setLobbyBusy(true); setLobbyErr('')
    try { enterRoom(await joinPrivateRoom(joinCode, user)) }
    catch (e) { setLobbyErr(e.message || 'שגיאה') }
    finally { setLobbyBusy(false) }
  }

  async function doCancel() {
    if (roomId && room) await cleanupRoom(roomId, room.code, user.uid)
    goLobby()
  }

  // ══════════════════ RENDER ══════════════════════════════════════════════════

  if (!user || view === null) return <Spinner />

  // ── Nickname screen ────────────────────────────────────────────────────────
  if (view === 'nickname') {
    async function submitNick(e) {
      e.preventDefault()
      const n = nick.trim()
      if (n.length < 2) { setNickErr('הכינוי חייב להכיל לפחות 2 תווים'); return }
      if (n.length > 16) { setNickErr('הכינוי ארוך מדי (עד 16 תווים)'); return }
      setNickBusy(true); setNickErr('')
      try {
        await updateProfile(user, { displayName: n })
        // Force re-read of user (onAuthStateChanged doesn't fire for profile updates)
        setView('lobby')
      } catch (err) {
        setNickErr('שגיאה בשמירת הכינוי')
        console.error(err)
      } finally {
        setNickBusy(false)
      }
    }

    async function loginGoogle() {
      try {
        await signInWithPopup(auth, gProvider)
        // onAuthStateChanged in AuthContext will update user → useEffect above routes to lobby
      } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user') setNickErr('שגיאה בכניסה עם Google')
      }
    }

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-between px-4 py-8">
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm gap-8">

          {/* Logo */}
          <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14 }}
            className="text-center">
            <motion.h1
              animate={{ textShadow: ['0 0 10px rgba(168,85,247,0.5)', '0 0 30px rgba(168,85,247,1)', '0 0 10px rgba(168,85,247,0.5)'] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="text-6xl font-black text-arena-neon mb-2">
              ⚔️ הזירה
            </motion.h1>
            <p className="text-gray-500 text-sm">דו-קרב חידות תחת לחץ זמן</p>
          </motion.div>

          {/* Nickname form */}
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}
            className="w-full bg-arena-surface border border-arena-border rounded-2xl p-6">
            <h2 className="text-lg font-black text-white mb-4 text-center">מה הכינוי שלך בזירה?</h2>

            {nickErr && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-red-400 text-sm text-center mb-3">{nickErr}</motion.p>
            )}

            <form onSubmit={submitNick} className="space-y-3">
              <input
                type="text" value={nick} onChange={e => setNick(e.target.value)}
                maxLength={16} placeholder="הכינוי שלך..." autoFocus
                className="w-full bg-arena-bg border border-arena-border rounded-xl px-4 py-3 text-white text-center font-bold text-lg focus:outline-none focus:border-arena-neon transition-all placeholder-gray-700" />
              <motion.button type="submit" disabled={nickBusy || nick.trim().length < 2}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                className="w-full bg-arena-neon text-white font-black py-3 rounded-xl shadow-neon disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                {nickBusy ? 'שומר...' : 'כנס לזירה ⚔️'}
              </motion.button>
            </form>
          </motion.div>

          {/* Divider */}
          <div className="flex items-center w-full gap-3">
            <div className="flex-1 h-px bg-arena-border" />
            <span className="text-gray-600 text-xs">או</span>
            <div className="flex-1 h-px bg-arena-border" />
          </div>

          {/* Google login */}
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
            onClick={loginGoogle} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full flex items-center justify-center gap-3 border-2 border-arena-border rounded-xl py-3 px-4 text-white font-bold hover:border-arena-neon transition-all">
            <GoogleIcon />
            כניסה עם Google
          </motion.button>
        </div>

        <NeonFooter />
      </motion.div>
    )
  }

  // ── Board game — multiplayer (main mode) ────────────────────────────────────
  if (view === 'board') {
    return <BoardMulti user={user} onExit={goLobby} />
  }

  // ── Board solo (practice vs bots, no Firebase) ───────────────────────────────
  if (view === 'board-solo') {
    return <Board user={user} onExit={goLobby} />
  }

  // ── Bot game ───────────────────────────────────────────────────────────────
  if (view === 'bot') {
    return <BotGame category={category} user={user} onExit={() => setView('lobby')} />
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
  if (view === 'lobby') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-arena-bg flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-arena-border">
          <h1 className="text-2xl font-black text-arena-neon" style={{ textShadow: '0 0 12px rgba(168,85,247,0.55)' }}>
            ⚔️ הזירה
          </h1>
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <p className="text-arena-neon font-bold text-xs">{user.displayName}</p>
              <p className="text-gray-600 text-[10px]">{user.isAnonymous ? 'אנונימי' : 'מחובר'}</p>
            </div>
            <Avatar photoURL={user.photoURL} name={user.displayName} />
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-5">

          <motion.div initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-center">
            <h2 className="text-3xl font-black text-white mb-1">בחר מצב משחק</h2>
            <p className="text-gray-600 text-sm">45 שניות · 3 פסילות · דלג = −3s</p>
          </motion.div>

          <div className="w-full max-w-sm space-y-4">

            {/* Category selector */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="bg-arena-surface border border-arena-border rounded-2xl p-4">
              <p className="text-arena-neon font-bold text-sm mb-3 text-center tracking-wide">בחר קטגוריה</p>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(cat => (
                  <motion.button key={cat.id} onClick={() => setCategory(cat.id)} whileTap={{ scale: 0.93 }}
                    className={`rounded-xl py-2 px-1 text-xs font-bold transition-all flex flex-col items-center gap-1 ${category === cat.id
                      ? 'bg-arena-neon/20 border-2 border-arena-neon text-arena-neon'
                      : 'bg-arena-bg border border-arena-border text-gray-500 hover:border-arena-border/80'
                      }`}>
                    <span className="text-lg leading-none">{cat.emoji}</span>
                    <span>{cat.id}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>

            {/* Error */}
            <AnimatePresence>
              {lobbyErr && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="bg-red-900/30 border border-red-500/40 text-red-300 rounded-xl px-4 py-2.5 text-sm text-center">
                  {lobbyErr}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Random */}
            <motion.button initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
              onClick={doRandom} disabled={lobbyBusy}
              whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.97 }}
              className="w-full bg-arena-surface border-2 border-arena-neon rounded-2xl p-4 flex items-center gap-4 hover:shadow-neon transition-all disabled:opacity-50 cursor-pointer">
              <span className="text-4xl flex-shrink-0">⚔️</span>
              <div className="flex-1 text-right">
                <p className="text-arena-neon font-black text-lg leading-tight">משחק אקראי</p>
                <p className="text-gray-500 text-xs mt-0.5">מצא יריב אמיתי ועלה לזירה</p>
              </div>
              {lobbyBusy
                ? <div className="w-5 h-5 border-2 border-arena-neon border-t-transparent rounded-full animate-spin flex-shrink-0" />
                : <span className="text-gray-600 flex-shrink-0">←</span>}
            </motion.button>

            {/* Private room */}
            <motion.div initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.18 }}
              className="bg-arena-surface border-2 border-arena-cyan rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-4xl flex-shrink-0">🔐</span>
                <div className="text-right">
                  <p className="text-arena-cyan font-black text-lg leading-tight">חדר פרטי</p>
                  <p className="text-gray-500 text-xs">שחק מול חבר עם קוד</p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={doCreatePrivate} disabled={lobbyBusy}
                  className="flex-1 bg-arena-cyan/10 border border-arena-cyan text-arena-cyan font-bold py-2.5 rounded-xl text-sm hover:bg-arena-cyan/20 transition-all disabled:opacity-50">
                  צור חדר
                </motion.button>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { setLobbyTab(t => t === 'join' ? 'main' : 'join'); setLobbyErr('') }}
                  disabled={lobbyBusy}
                  className={`flex-1 border font-bold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50 ${lobbyTab === 'join' ? 'bg-arena-cyan text-white border-arena-cyan' : 'text-gray-300 border-arena-border hover:border-arena-cyan'
                    }`}>
                  הצטרף
                </motion.button>
              </div>
              <AnimatePresence>
                {lobbyTab === 'join' && (
                  <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} onSubmit={doJoinPrivate}
                    className="flex gap-2 overflow-hidden">
                    <input type="text" value={joinCode} maxLength={7} dir="ltr" placeholder="XKQPLMZ"
                      onChange={e => setJoinCode(e.target.value.toUpperCase())}
                      className="flex-1 bg-arena-bg border border-arena-border rounded-xl px-3 py-2.5 text-white text-center tracking-[0.28em] font-mono font-bold uppercase focus:outline-none focus:border-arena-cyan transition-all placeholder-gray-700" />
                    <motion.button type="submit" disabled={lobbyBusy || joinCode.length !== 7}
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      className="bg-arena-cyan text-white font-bold px-4 rounded-xl disabled:opacity-40">
                      {lobbyBusy ? '...' : 'כנס'}
                    </motion.button>
                  </motion.form>
                )}
              </AnimatePresence>
            </motion.div>

            {/* ══ Board — MAIN MODE ══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}
              className="bg-arena-surface border-2 border-arena-neon rounded-2xl p-4 hover:shadow-neon transition-all"
              style={{ boxShadow: '0 0 0 1px rgba(168,85,247,0.15)' }}>

              {/* Title row */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-4xl flex-shrink-0">🗺️</span>
                <div className="flex-1 text-right">
                  <p className="text-arena-neon font-black text-lg leading-tight">כיבוש הזירה</p>
                  <p className="text-gray-500 text-xs">לוח 5×5 · כבוש 13 טריטוריות · בוטים + שחקנים</p>
                </div>
                <span className="text-arena-neon text-[10px] font-black bg-arena-neon/10 px-2 py-0.5 rounded-full flex-shrink-0">
                  מרכזי
                </span>
              </div>

              {/* Two sub-buttons */}
              <div className="grid grid-cols-2 gap-2">
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                  onClick={() => setView('board')}
                  className="bg-arena-neon/10 border border-arena-neon text-arena-neon font-black py-2.5 rounded-xl text-sm hover:bg-arena-neon/20 transition-all flex items-center justify-center gap-1.5">
                  <span>🌐</span>
                  <span>מולטיפלייר</span>
                </motion.button>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                  onClick={() => setView('board-solo')}
                  className="bg-arena-bg border border-arena-border text-gray-300 font-bold py-2.5 rounded-xl text-sm hover:border-arena-neon/50 transition-all flex items-center justify-center gap-1.5">
                  <span>🤖</span>
                  <span>אימון סולו</span>
                </motion.button>
              </div>
            </motion.div>

            {/* Bot 1v1 duel */}
            <motion.button initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.34 }}
              onClick={() => setView('bot')}
              whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.97 }}
              className="w-full bg-arena-surface border-2 border-arena-gold rounded-2xl p-4 flex items-center gap-4 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all cursor-pointer">
              <span className="text-4xl flex-shrink-0">⚔️</span>
              <div className="flex-1 text-right">
                <p className="text-arena-gold font-black text-lg leading-tight">דו-קרב מהיר</p>
                <p className="text-gray-500 text-xs mt-0.5">45 שניות · 3 פסילות · 1v1 נגד בוט</p>
              </div>
              <span className="text-gray-600 flex-shrink-0">←</span>
            </motion.button>
          </div>
        </main>

        <NeonFooter />
      </motion.div>
    )
  }

  // ── Game view ──────────────────────────────────────────────────────────────
  if (!room) return <Spinner />

  if (room.status === 'waiting') {
    return (
      <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center gap-5">
        <div className="relative">
          <motion.div animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.5, 0.15] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-arena-neon/20" />
          <div className="relative w-28 h-28 rounded-full border-4 border-arena-neon flex items-center justify-center text-4xl shadow-neon">⚔️</div>
        </div>
        {room.isPrivate && room.code ? (
          <>
            <p className="text-gray-500 text-sm">קוד החדר</p>
            <motion.div
              animate={{ boxShadow: ['0 0 8px rgba(6,182,212,0.2)', '0 0 28px rgba(6,182,212,0.6)', '0 0 8px rgba(6,182,212,0.2)'] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="bg-arena-surface border-2 border-arena-cyan rounded-2xl px-8 py-4">
              <span className="text-arena-cyan font-black text-4xl tracking-[0.25em] font-mono" style={{ direction: 'ltr', display: 'block' }}>{room.code}</span>
            </motion.div>
            <p className="text-gray-600 text-sm">שתף את הקוד עם חברך</p>
          </>
        ) : (
          <WaitingDots label="מחפש יריב" />
        )}
        <button onClick={doCancel} className="text-gray-700 hover:text-red-400 text-sm underline transition-colors">ביטול וחזרה ללובי</button>
      </div>
    )
  }

  if (room.status === 'generating') return <GeneratingView />

  // ── Result ──────────────────────────────────────────────────────────────
  if (room.status === 'finished') {
    const isWin = room.winner === user?.uid
    const winnerData = room.players?.[room.winner]
    const pList = Object.entries(room.players ?? {})
    const SPARKS = ['🏆', '✨', '⭐', '🌟', '💫', '🎉']

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center relative overflow-hidden">
        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.06, 0.18, 0.06] }}
          transition={{ duration: 2.5, repeat: Infinity }}
          className={`absolute w-96 h-96 rounded-full blur-3xl pointer-events-none ${isWin ? 'bg-arena-gold' : 'bg-red-700'}`} />

        {isWin && SPARKS.map((e, i) => (
          <motion.span key={i}
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: -160, opacity: [0, 1, 1, 0], x: (i % 2 ? 1 : -1) * (8 + i * 10) }}
            transition={{ delay: i * 0.15, duration: 2.1, repeat: Infinity, repeatDelay: 0.7 }}
            className="absolute text-2xl pointer-events-none select-none" style={{ left: `${10 + i * 14}%` }}>
            {e}
          </motion.span>
        ))}

        <motion.div initial={{ scale: 0, rotate: isWin ? -25 : 0 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 250, damping: 14, delay: 0.08 }}
          className="text-8xl mb-3 relative z-10 select-none">
          {isWin ? '🏆' : '💀'}
        </motion.div>

        <motion.h1 initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.28 }}
          className={`text-5xl font-black mb-1 relative z-10 ${isWin ? 'text-arena-gold' : 'text-red-400'}`}
          style={isWin ? { textShadow: '0 0 18px rgba(245,158,11,0.55)' } : {}}>
          {isWin ? 'ניצחת בקרב!' : 'הודחת!'}
        </motion.h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
          className="text-gray-400 text-sm mb-6 relative z-10">
          {isWin ? `כל הכבוד ${winnerData?.displayName ?? ''}! 🎖️` : `${winnerData?.displayName ?? 'היריב'} ניצח בדו-קרב`}
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.52 }}
          className="flex gap-5 sm:gap-8 mb-8 relative z-10">
          {pList.map(([uid, data]) => {
            const won = uid === room.winner
            return (
              <div key={uid} className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${won ? 'border-arena-gold/50 bg-arena-gold/5' : 'border-arena-border bg-arena-surface/50'}`}>
                <Avatar photoURL={data.photoURL} name={data.displayName} size="md" ring={won ? 'border-arena-gold' : 'border-gray-600'} />
                <span className={`text-xs font-semibold ${won ? 'text-arena-gold' : 'text-gray-400'}`}>{data.displayName}</span>
                <span className={`text-sm font-black ${won ? 'text-arena-gold' : 'text-gray-500'}`}>{Math.ceil(timers[uid] ?? data.timeLeft)}s</span>
                <Strikes count={data.strikes ?? 0} />
                {won && <span className="text-xs text-arena-gold">🥇 מנצח</span>}
              </div>
            )
          })}
        </motion.div>

        <motion.button initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.93 }}
          onClick={goLobby}
          className={`relative z-10 px-10 py-3 rounded-xl text-white font-black text-lg transition-all ${isWin ? 'bg-arena-gold shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:shadow-[0_0_32px_rgba(245,158,11,0.65)]' : 'bg-arena-neon shadow-neon'
            }`}>
          חזרה ללובי
        </motion.button>
      </motion.div>
    )
  }

  // ── Active multiplayer game ──────────────────────────────────────────────
  const { currentQuestionIndex, questions, players, currentTurn, isPrivate, code } = room
  const pList = Object.entries(players ?? {})
  const currentQ = questions?.[currentQuestionIndex]
  const isMyTurn = currentTurn === user?.uid
  const OL = ['א', 'ב', 'ג', 'ד']

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-arena-bg flex flex-col">
      <header className="border-b border-arena-border px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <span className="text-gray-600 text-xs">שאלה {(currentQuestionIndex ?? 0) + 1}/{questions?.length ?? 10}</span>
        <h1 className="text-base font-black text-arena-neon">⚔️ הזירה</h1>
        <span className="text-gray-700 text-xs">{isPrivate ? `🔐 ${code}` : '🌐 אקראי'}</span>
      </header>

      {/* Players */}
      <div className="bg-arena-surface border-b border-arena-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-around max-w-md mx-auto">
          {pList.map(([uid, data], idx) => {
            const isActive = uid === currentTurn
            const isMe = uid === user?.uid
            const secs = timers[uid] ?? data.timeLeft
            return (
              <React.Fragment key={uid}>
                <div className={`flex flex-col items-center gap-1.5 transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-45'}`}>
                  <div className="relative flex-shrink-0">
                    <Avatar photoURL={data.photoURL} name={data.displayName} size="md" ring={isMe ? 'border-arena-neon' : 'border-gray-500'} />
                    {isActive && (
                      <motion.span animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 0.85, repeat: Infinity }}
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-arena-neon border-2 border-arena-bg" />
                    )}
                  </div>
                  <span className={`text-[11px] font-semibold max-w-[72px] truncate ${isMe ? 'text-arena-neon' : 'text-gray-300'}`}>
                    {data.displayName}{isMe && ' (אתה)'}
                  </span>
                  <TimerRing secs={secs} active={isActive} px={62} />
                  <Strikes count={data.strikes ?? 0} />
                </div>
                {idx < pList.length - 1 && <span className="text-gray-700 font-black text-lg flex-shrink-0">VS</span>}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Turn */}
      <div className="py-1.5 text-center flex-shrink-0">
        {isMyTurn ? (
          <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.3, repeat: Infinity }}
            className="text-arena-neon text-xs font-bold">✨ התור שלך — ענה!</motion.span>
        ) : (
          <span className="text-gray-600 text-xs">ממתין לתשובת {players?.[currentTurn]?.displayName ?? 'היריב'}...</span>
        )}
      </div>

      {/* Question */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-3 gap-4 overflow-y-auto">
        <AnimatePresence mode="wait">
          {currentQ ? (
            <motion.div key={currentQ.id ?? currentQuestionIndex}
              initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.27 }}
              className="bg-arena-surface border border-arena-border rounded-2xl p-5 w-full max-w-xl">
              <span className="inline-block text-xs text-arena-neon bg-purple-900/30 border border-purple-800 px-3 py-1 rounded-full mb-4">
                {currentQ.category ?? currentQ.topic}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-white leading-relaxed mb-5">{currentQ.question}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {currentQ.options.map((opt, i) => {
                  let cls = 'border-arena-border bg-arena-bg text-gray-400 cursor-default'
                  if (!reveal && isMyTurn) cls = 'border-arena-border bg-arena-bg text-white hover:border-arena-neon hover:bg-purple-900/15 cursor-pointer'
                  else if (reveal) {
                    if (opt === reveal) cls = 'border-green-500 bg-green-900/25 text-green-300'
                    else cls = 'border-arena-border bg-arena-bg opacity-35 text-gray-600 cursor-default'
                  }
                  return (
                    <motion.button key={`${currentQuestionIndex}-${i}`}
                      onClick={() => isMyTurn && !reveal && handleAnswer(opt)}
                      whileHover={isMyTurn && !reveal ? { scale: 1.02 } : {}}
                      whileTap={isMyTurn && !reveal ? { scale: 0.97 } : {}}
                      className={`flex items-center gap-3 border-2 rounded-xl px-3.5 py-3 text-right transition-all text-sm font-medium ${cls}`}>
                      <span className="w-7 h-7 rounded-lg bg-arena-surface border border-arena-border flex items-center justify-center text-xs font-black text-gray-500 flex-shrink-0">{OL[i]}</span>
                      <span className="flex-1 text-right leading-tight">{opt}</span>
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          ) : (
            <p className="text-gray-600 text-sm">טוען שאלה...</p>
          )}
        </AnimatePresence>

        {isMyTurn && !reveal && (
          <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            onClick={handleSkip} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
            className="border border-arena-border text-gray-500 hover:border-red-500/60 hover:text-red-400 transition-all rounded-xl px-5 py-2 text-sm font-semibold flex items-center gap-2">
            <span>⚡ דלג</span>
            <span className="text-red-500/60 text-xs">−{SKIP_PENALTY}s</span>
          </motion.button>
        )}
      </main>
    </motion.div>
  )
}
