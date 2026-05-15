/**
 * Arena.jsx — לב המשחק של הזירה
 * ============================================================
 * State machine: lobby → waiting → generating → active → finished
 * RTDB path: rooms/{roomId}
 * Timer: 45 שניות לכל שחקן. רק שעון אחד פועל בכל עת.
 * ============================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ref, set, get, push, update, onValue, remove,
} from 'firebase/database'
import {
  GoogleAuthProvider, linkWithPopup, updateProfile,
} from 'firebase/auth'
import { auth, rtdb } from '../firebase'
import { useAuth } from '../context/AuthContext'

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMER_START  = 45          // seconds per player
const SKIP_PENALTY = 3           // seconds deducted on skip
const REVEAL_MS    = 1400        // reveal pause before advancing
const CHARS        = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const googleProvider = new GoogleAuthProvider()

const LOADING_MSGS = [
  'מייצר זירה...',
  'מרכיב שאלות...',
  'מכין את הדו-קרב...',
  'בוחר נושאים...',
  'מגדיר את הכללים...',
]

const GEMINI_KEY = 'AIzaSyAS5ORmG9Q-at3K1RaOEofBn5m-Qnm9CfY'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`

// ─── Gemini question generator ────────────────────────────────────────────────

const PROMPT = `Generate exactly 10 Hebrew trivia questions, each from a completely different topic.
Return ONLY a raw JSON array — no markdown, no code fences, no extra text.
Each element:
{"topic":"<Hebrew topic>","question":"<Hebrew question>","options":["opt1","opt2","opt3","opt4"],"correctIndex":<0-3>}
correctIndex is the 0-based index of the correct answer. All text must be in Hebrew.
Start your response with [ and end with ].`

async function fetchGeminiQuestions() {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  // Robust JSON extraction
  let raw
  try { raw = JSON.parse(text.trim()) } catch {
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) throw new Error('No JSON array in Gemini response')
    raw = JSON.parse(m[0])
  }

  if (!Array.isArray(raw) || raw.length < 10) throw new Error('Invalid questions count')
  return raw.slice(0, 10).map((q, i) => ({
    id:           i + 1,
    topic:        q.topic        ?? `נושא ${i + 1}`,
    category:     q.topic        ?? `נושא ${i + 1}`,
    question:     q.question,
    options:      q.options,
    correctIndex: q.correctIndex,
    correct:      q.options[q.correctIndex],
  }))
}

async function generateQuestions() {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await fetchGeminiQuestions() }
    catch (err) {
      lastErr = err
      console.warn(`Gemini attempt ${attempt}:`, err.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 900 * attempt))
    }
  }
  throw lastErr
}

// ─── RTDB room helpers ────────────────────────────────────────────────────────

function genCode() {
  let c = ''
  for (let i = 0; i < 7; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)]
  return c
}

function playerEntry(user) {
  return {
    displayName: user.displayName || 'שחקן',
    photoURL:    user.photoURL    || null,
    timeLeft:    TIMER_START,
    isAnonymous: !!user.isAnonymous,
  }
}

async function joinPublicRoom(user) {
  // Look for a waiting public room
  const qSnap = await get(ref(rtdb, 'publicQueue'))
  if (qSnap.exists()) {
    for (const roomId of Object.keys(qSnap.val())) {
      const rSnap = await get(ref(rtdb, `rooms/${roomId}`))
      const room  = rSnap.val()
      if (
        room?.status === 'waiting' &&
        !room.players[user.uid] &&
        Object.keys(room.players).length < 2
      ) {
        await update(ref(rtdb, `rooms/${roomId}/players/${user.uid}`), playerEntry(user))
        await remove(ref(rtdb, `publicQueue/${roomId}`))
        return roomId
      }
    }
  }

  // No room found — create one
  const newRef = push(ref(rtdb, 'rooms'))
  const roomId = newRef.key
  await set(newRef, {
    status:               'waiting',
    isPrivate:            false,
    code:                 null,
    hostUid:              user.uid,
    currentTurn:          user.uid,
    turnStarted:          Date.now(),
    currentQuestionIndex: 0,
    players:              { [user.uid]: playerEntry(user) },
    questions:            null,
    winner:               null,
    createdAt:            Date.now(),
  })
  await set(ref(rtdb, `publicQueue/${roomId}`), true)
  return roomId
}

async function createPrivateRoom(user) {
  const code   = genCode()
  const newRef = push(ref(rtdb, 'rooms'))
  const roomId = newRef.key
  await set(newRef, {
    status:               'waiting',
    isPrivate:            true,
    code,
    hostUid:              user.uid,
    currentTurn:          user.uid,
    turnStarted:          Date.now(),
    currentQuestionIndex: 0,
    players:              { [user.uid]: playerEntry(user) },
    questions:            null,
    winner:               null,
    createdAt:            Date.now(),
  })
  await set(ref(rtdb, `roomCodes/${code}`), roomId)
  return { roomId, code }
}

async function joinPrivateRoom(codeRaw, user) {
  const code  = codeRaw.trim().toUpperCase()
  const cSnap = await get(ref(rtdb, `roomCodes/${code}`))
  if (!cSnap.exists()) throw new Error('קוד חדר לא נמצא')

  const roomId = cSnap.val()
  const rSnap  = await get(ref(rtdb, `rooms/${roomId}`))
  const room   = rSnap.val()

  if (!room)                                  throw new Error('החדר לא קיים')
  if (room.status !== 'waiting')              throw new Error('המשחק כבר התחיל')
  if (Object.keys(room.players).length >= 2)  throw new Error('החדר מלא')
  if (room.players[user.uid])                 return roomId  // already in

  await update(ref(rtdb, `rooms/${roomId}/players/${user.uid}`), playerEntry(user))
  return roomId
}

async function cleanupRoom(roomId, code, uid) {
  const updates = { [`rooms/${roomId}/players/${uid}`]: null }
  if (code) updates[`roomCodes/${code}`] = null
  updates[`publicQueue/${roomId}`] = null
  await update(ref(rtdb), updates)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen bg-arena-bg flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-arena-neon border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ArenaFooter() {
  return (
    <footer className="text-center py-4 border-t border-arena-border/40">
      <motion.p
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        className="text-xs tracking-widest uppercase select-none"
      >
        <span className="text-gray-600">Developed by </span>
        <span className="text-arena-neon font-black" style={{ textShadow: '0 0 8px rgba(168,85,247,0.6)' }}>Peretzinho</span>
        <span className="text-gray-700 mx-2">·</span>
        <span className="text-gray-700">© 2025</span>
      </motion.p>
    </footer>
  )
}

function PlayerAvatar({ photoURL, displayName, size = 'sm' }) {
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs'
  if (photoURL) {
    return (
      <img src={photoURL} alt={displayName} referrerPolicy="no-referrer"
        className={`${sz} rounded-full object-cover border-2 border-arena-neon shadow-neon flex-shrink-0`} />
    )
  }
  return (
    <div className={`${sz} rounded-full border-2 border-arena-neon bg-arena-surface flex items-center justify-center text-arena-neon font-black flex-shrink-0`}>
      {displayName?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

// Circular timer ring
function TimerRing({ seconds, max = TIMER_START, active, size = 80 }) {
  const radius    = (size - 10) / 2
  const circumf   = 2 * Math.PI * radius
  const pct       = Math.max(0, Math.min(1, seconds / max))
  const dashOffset = circumf * (1 - pct)

  const color = seconds > 15 ? '#a855f7' : seconds > 7 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        {/* Background track */}
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#1e1e2e" strokeWidth={5} />
        {/* Progress arc */}
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumf}
          strokeDashoffset={dashOffset}
          style={{ filter: active ? `drop-shadow(0 0 4px ${color})` : 'none' }}
          transition={{ duration: 0.1 }}
        />
      </svg>
      {/* Seconds label */}
      <span className={`text-sm font-black tabular-nums relative z-10 ${
        seconds <= 7 ? 'text-red-400' : seconds <= 15 ? 'text-arena-gold' : 'text-white'
      } ${active && seconds <= 7 ? 'animate-pulse' : ''}`}>
        {Math.ceil(seconds)}
      </span>
    </div>
  )
}

function GeneratingScreen() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % LOADING_MSGS.length), 1800)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4">
      <div className="relative w-32 h-32 mb-10">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full border-4 border-t-arena-neon border-r-arena-neon border-b-transparent border-l-transparent" />
        <motion.div animate={{ rotate: -360 }} transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-3 rounded-full border-2 border-b-arena-cyan border-l-arena-cyan border-t-transparent border-r-transparent" />
        <div className="absolute inset-0 flex items-center justify-center text-4xl">⚔️</div>
      </div>
      <AnimatePresence mode="wait">
        <motion.p key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35 }}
          className="text-arena-neon text-xl font-bold mb-3"
          style={{ textShadow: '0 0 12px rgba(168,85,247,0.7)' }}>
          {LOADING_MSGS[idx]}
        </motion.p>
      </AnimatePresence>
      <p className="text-gray-600 text-sm mb-6">הבינה המלאכותית מכינה שאלות ייחודיות</p>
      <div className="flex gap-2">
        {[0, 1, 2].map(i => (
          <motion.div key={i}
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            className="w-2 h-2 rounded-full bg-arena-neon" />
        ))}
      </div>
    </div>
  )
}

// ─── Main Arena component (state machine) ────────────────────────────────────

export default function Arena() {
  const { user } = useAuth()

  // ── View state ──
  const [view, setView]     = useState('lobby')   // 'lobby' | 'game'
  const [roomId, setRoomId] = useState(null)
  const [room, setRoom]     = useState(null)

  // ── Lobby state ──
  const [lobbyTab, setLobbyTab]     = useState('main')  // 'main' | 'join'
  const [joinCode, setJoinCode]     = useState('')
  const [lobbyError, setLobbyError] = useState('')
  const [lobbyLoading, setLobbyLoading] = useState(false)

  // ── Game state ──
  const [timers, setTimers]   = useState({})    // { [uid]: displayed seconds }
  const [reveal, setReveal]   = useState(null)  // correct answer string to show
  const processingRef         = useRef(false)
  const generatingRef         = useRef(false)

  // ── Listen to room ──
  useEffect(() => {
    if (!roomId) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}`), snap => {
      if (!snap.exists()) {
        setRoomId(null); setRoom(null); setView('lobby'); return
      }
      setRoom(snap.val())
    })
    return unsub
  }, [roomId])

  // ── Host: trigger Gemini when 2nd player joins ──
  useEffect(() => {
    if (!room || !roomId) return
    if (room.hostUid !== user.uid) return
    if (room.status !== 'waiting') return
    if (Object.keys(room.players || {}).length < 2) return
    if (generatingRef.current) return

    generatingRef.current = true

    const playerUids = Object.keys(room.players)
    // "Ziri" protection: random first turn
    const firstTurn  = playerUids[Math.floor(Math.random() * playerUids.length)]

    update(ref(rtdb, `rooms/${roomId}`), { status: 'generating' })
      .then(() => generateQuestions())
      .then(qs => update(ref(rtdb, `rooms/${roomId}`), {
        questions:    qs,
        status:       'active',
        currentTurn:  firstTurn,
        turnStarted:  Date.now(),
      }))
      .catch(err => {
        console.error('Gemini failed:', err)
        generatingRef.current = false
      })
  }, [room, roomId, user.uid])

  // ── Local timer countdown ──
  useEffect(() => {
    if (!room || room.status !== 'active') return

    const activeTurn   = room.currentTurn
    const turnStart    = room.turnStarted
    const playersSnap  = room.players || {}

    const interval = setInterval(() => {
      const now     = Date.now()
      const elapsed = (now - turnStart) / 1000

      const next = {}
      Object.entries(playersSnap).forEach(([uid, data]) => {
        next[uid] = uid === activeTurn
          ? Math.max(0, data.timeLeft - elapsed)
          : data.timeLeft
      })
      setTimers(next)

      // Time expired for the active turn player
      if (next[activeTurn] <= 0 && activeTurn === user.uid && !processingRef.current) {
        clearInterval(interval)
        handleTimeUp(room, roomId)
      }
    }, 100)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.currentTurn, room?.turnStarted, room?.status])

  // ── Reset flags when question index changes ──
  useEffect(() => {
    setReveal(null)
    processingRef.current = false
  }, [room?.currentQuestionIndex, room?.status])

  // ── Helpers ──

  function getMyRemaining() {
    if (!room) return TIMER_START
    const elapsed = (Date.now() - room.turnStarted) / 1000
    return Math.max(0, (room.players[user.uid]?.timeLeft ?? TIMER_START) - elapsed)
  }

  function oppUid() {
    return Object.keys(room?.players || {}).find(u => u !== user.uid)
  }

  async function handleTimeUp(currentRoom, currentRoomId) {
    if (processingRef.current) return
    processingRef.current = true
    const opp = Object.keys(currentRoom.players).find(u => u !== user.uid)
    await update(ref(rtdb, `rooms/${currentRoomId}`), {
      winner: opp || user.uid,
      status: 'finished',
    }).catch(console.error)
  }

  const handleAnswer = useCallback(async selectedOption => {
    if (!room || !roomId || processingRef.current) return
    if (room.currentTurn !== user.uid) return
    processingRef.current = true

    const myRemaining = getMyRemaining()
    const opp         = oppUid()
    const question    = room.questions[room.currentQuestionIndex]
    const isCorrect   = selectedOption !== null && selectedOption === question.correct

    if (myRemaining <= 0) {
      await update(ref(rtdb, `rooms/${roomId}`), { winner: opp, status: 'finished' })
      return
    }

    setReveal(question.correct)

    setTimeout(async () => {
      const nextIdx = room.currentQuestionIndex + 1

      if (nextIdx >= room.questions.length) {
        // All questions answered — most remaining time wins
        const oppTime = room.players[opp]?.timeLeft ?? 0
        const winner  = myRemaining >= oppTime ? user.uid : opp
        await update(ref(rtdb, `rooms/${roomId}`), { winner, status: 'finished' })
        return
      }

      await update(ref(rtdb), {
        [`rooms/${roomId}/currentTurn`]:              opp,
        [`rooms/${roomId}/turnStarted`]:              Date.now(),
        [`rooms/${roomId}/currentQuestionIndex`]:     nextIdx,
        [`rooms/${roomId}/players/${user.uid}/timeLeft`]: myRemaining,
      }).catch(console.error)
      processingRef.current = false
    }, REVEAL_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, roomId, user.uid])

  const handleSkip = useCallback(async () => {
    if (!room || !roomId || processingRef.current) return
    if (room.currentTurn !== user.uid) return
    processingRef.current = true

    const afterPenalty = Math.max(0, getMyRemaining() - SKIP_PENALTY)
    const opp          = oppUid()

    if (afterPenalty <= 0) {
      await update(ref(rtdb, `rooms/${roomId}`), { winner: opp, status: 'finished' })
      return
    }

    const nextIdx = room.currentQuestionIndex + 1
    if (nextIdx >= room.questions.length) {
      const oppTime = room.players[opp]?.timeLeft ?? 0
      const winner  = afterPenalty >= oppTime ? user.uid : opp
      await update(ref(rtdb, `rooms/${roomId}`), { winner, status: 'finished' })
      return
    }

    await update(ref(rtdb), {
      [`rooms/${roomId}/currentTurn`]:              opp,
      [`rooms/${roomId}/turnStarted`]:              Date.now(),
      [`rooms/${roomId}/currentQuestionIndex`]:     nextIdx,
      [`rooms/${roomId}/players/${user.uid}/timeLeft`]: afterPenalty,
    }).catch(console.error)
    processingRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, roomId, user.uid])

  // ── Navigation ──

  function enterRoom(id) { setRoomId(id); setView('game') }

  function leaveGame() {
    setView('lobby'); setRoomId(null); setRoom(null)
    generatingRef.current = false; processingRef.current = false
    setTimers({}); setReveal(null)
  }

  async function handleCancel() {
    if (roomId && room) await cleanupRoom(roomId, room.code, user.uid).catch(() => {})
    leaveGame()
  }

  // ── Lobby actions ──

  async function doRandom() {
    setLobbyLoading(true); setLobbyError('')
    try { enterRoom(await joinPublicRoom(user)) }
    catch (err) { setLobbyError(err.message || 'שגיאה') }
    finally { setLobbyLoading(false) }
  }

  async function doCreatePrivate() {
    setLobbyLoading(true); setLobbyError('')
    try { const { roomId: id } = await createPrivateRoom(user); enterRoom(id) }
    catch (err) { setLobbyError(err.message || 'שגיאה') }
    finally { setLobbyLoading(false) }
  }

  async function doJoinPrivate(e) {
    e.preventDefault()
    if (joinCode.trim().length !== 7) { setLobbyError('הקוד חייב להיות 7 תווים'); return }
    setLobbyLoading(true); setLobbyError('')
    try { enterRoom(await joinPrivateRoom(joinCode, user)) }
    catch (err) { setLobbyError(err.message || 'שגיאה') }
    finally { setLobbyLoading(false) }
  }

  async function doGoogleUpgrade() {
    try {
      const cred = await linkWithPopup(user, googleProvider)
      await updateProfile(cred.user, {
        displayName: cred.user.displayName,
        photoURL:    cred.user.photoURL,
      })
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') console.error(err)
    }
  }

  // ════════════════════════════════
  // ══  RENDER STATES  ════════════
  // ════════════════════════════════

  // ── Lobby ─────────────────────────────────────────────────────────────────
  if (view === 'lobby') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="min-h-screen bg-arena-bg flex flex-col">

        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-arena-border gap-2">
          <h1 className="text-2xl font-black text-arena-neon" style={{ textShadow: '0 0 12px rgba(168,85,247,0.6)' }}>
            ⚔️ הזירה
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <PlayerAvatar photoURL={user.photoURL} displayName={user.displayName} />
            <div className="text-right hidden sm:block">
              <p className="text-arena-neon font-bold text-xs leading-tight">{user.displayName}</p>
              <p className="text-gray-600 text-[10px]">{user.isAnonymous ? 'אנונימי' : 'מחובר'}</p>
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">

          <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-center">
            <h2 className="text-3xl font-black text-white mb-1">בחר מצב משחק</h2>
            <p className="text-gray-500 text-sm">45 שניות לכל שחקן — הזמן הוא הכוח</p>
          </motion.div>

          {/* Error */}
          <AnimatePresence>
            {lobbyError && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="bg-red-900/40 border border-red-500/50 text-red-300 rounded-xl px-4 py-3 text-sm w-full max-w-sm text-center">
                {lobbyError}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="w-full max-w-sm space-y-4">

            {/* Random */}
            <motion.button initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
              onClick={doRandom} disabled={lobbyLoading}
              whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}
              className="w-full bg-arena-surface border-2 border-arena-neon rounded-2xl p-5 flex items-center gap-4 hover:shadow-neon transition-all disabled:opacity-50 cursor-pointer">
              <span className="text-4xl flex-shrink-0">⚔️</span>
              <div className="flex-1 text-right">
                <p className="text-arena-neon font-black text-lg">משחק אקראי</p>
                <p className="text-gray-500 text-xs mt-0.5">מצא יריב זמין ועלה לזירה</p>
              </div>
              <span className="text-gray-600">←</span>
            </motion.button>

            {/* Private */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
              className="bg-arena-surface border-2 border-arena-cyan rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-4">
                <span className="text-4xl flex-shrink-0">🔐</span>
                <div className="flex-1 text-right">
                  <p className="text-arena-cyan font-black text-lg">חדר פרטי</p>
                  <p className="text-gray-500 text-xs mt-0.5">שחק מול חבר עם קוד</p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={doCreatePrivate} disabled={lobbyLoading}
                  className="flex-1 bg-arena-cyan/10 border border-arena-cyan text-arena-cyan font-bold py-2.5 rounded-xl text-sm hover:bg-arena-cyan/20 transition-all disabled:opacity-50">
                  צור חדר
                </motion.button>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { setLobbyTab(t => t === 'join' ? 'main' : 'join'); setLobbyError('') }}
                  disabled={lobbyLoading}
                  className={`flex-1 border font-bold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50 ${
                    lobbyTab === 'join'
                      ? 'bg-arena-cyan text-white border-arena-cyan'
                      : 'text-gray-300 border-arena-border hover:border-arena-cyan'
                  }`}>
                  הצטרף
                </motion.button>
              </div>
              <AnimatePresence>
                {lobbyTab === 'join' && (
                  <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} onSubmit={doJoinPrivate}
                    className="flex gap-2 overflow-hidden">
                    <input type="text" value={joinCode}
                      onChange={e => setJoinCode(e.target.value.toUpperCase())}
                      maxLength={7} dir="ltr" placeholder="XKQPLMZ"
                      className="flex-1 bg-arena-bg border border-arena-border rounded-xl px-3 py-2.5 text-white text-center tracking-[0.3em] font-mono font-bold uppercase focus:outline-none focus:border-arena-cyan transition-all placeholder-gray-700" />
                    <motion.button type="submit" disabled={lobbyLoading || joinCode.length !== 7}
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      className="bg-arena-cyan text-white font-bold px-4 rounded-xl disabled:opacity-40">
                      {lobbyLoading ? '...' : 'כנס'}
                    </motion.button>
                  </motion.form>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Google upgrade (anonymous users only) */}
            {user.isAnonymous && (
              <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                onClick={doGoogleUpgrade} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="w-full border border-arena-border rounded-xl py-3 px-4 flex items-center justify-center gap-3 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-all text-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" className="flex-shrink-0">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                שדרג לחשבון Google
              </motion.button>
            )}
          </div>
        </main>

        <ArenaFooter />
      </motion.div>
    )
  }

  // ── Game view ────────────────────────────────────────────────────────────
  if (!room) return <Spinner />

  if (room.status === 'waiting') {
    return (
      <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center">
        <div className="relative mb-10">
          <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.6, 0.2] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-arena-neon/20" />
          <div className="relative w-28 h-28 rounded-full border-4 border-arena-neon flex items-center justify-center text-5xl shadow-neon">
            ⚔️
          </div>
        </div>

        {room.isPrivate && room.code ? (
          <>
            <p className="text-gray-400 text-sm mb-2">קוד החדר</p>
            <motion.div
              animate={{ boxShadow: ['0 0 10px rgba(6,182,212,0.3)', '0 0 28px rgba(6,182,212,0.7)', '0 0 10px rgba(6,182,212,0.3)'] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="bg-arena-surface border-2 border-arena-cyan rounded-2xl px-8 py-4 mb-6">
              <span className="text-arena-cyan font-black text-4xl tracking-[0.25em] font-mono"
                style={{ direction: 'ltr', display: 'block' }}>
                {room.code}
              </span>
            </motion.div>
            <p className="text-gray-500 text-sm mb-8">שתף את הקוד עם חברך</p>
          </>
        ) : (
          <>
            <WaitingDots label="מחפש יריב" />
            <p className="text-gray-500 text-sm mb-8">ממתין לשחקן שני</p>
          </>
        )}
        <button onClick={handleCancel}
          className="text-gray-600 hover:text-red-400 text-sm underline transition-colors">
          ביטול וחזרה ללובי
        </button>
      </div>
    )
  }

  if (room.status === 'generating') return <GeneratingScreen />

  // ── Finished ────────────────────────────────────────────────────────────
  if (room.status === 'finished') {
    const isWinner   = room.winner === user.uid
    const winnerData = room.players?.[room.winner]
    const playerList = Object.entries(room.players || {})
    const SPARKLES   = ['🏆', '✨', '⭐', '🌟', '💫', '🎉']

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center relative overflow-hidden">

        {/* Ambient glow */}
        <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.07, 0.2, 0.07] }}
          transition={{ duration: 2.5, repeat: Infinity }}
          className={`absolute w-96 h-96 rounded-full blur-3xl pointer-events-none ${isWinner ? 'bg-arena-gold' : 'bg-red-600'}`} />

        {/* Sparkles — winner */}
        {isWinner && SPARKLES.map((e, i) => (
          <motion.span key={i}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: -160, opacity: [0, 1, 1, 0], x: (i % 2 === 0 ? 1 : -1) * (8 + i * 9) }}
            transition={{ delay: i * 0.16, duration: 2.2, repeat: Infinity, repeatDelay: 0.8 }}
            className="absolute text-2xl pointer-events-none select-none"
            style={{ left: `${10 + i * 14}%` }}>
            {e}
          </motion.span>
        ))}

        <motion.div initial={{ scale: 0, rotate: isWinner ? -25 : 0 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.1 }}
          className="text-8xl mb-4 relative z-10 select-none">
          {isWinner ? '🏆' : '💀'}
        </motion.div>

        <motion.h1 initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
          className={`text-5xl font-black mb-1 relative z-10 ${isWinner ? 'text-arena-gold' : 'text-red-400'}`}
          style={isWinner ? { textShadow: '0 0 20px rgba(245,158,11,0.6)' } : {}}>
          {isWinner ? 'ניצחת!' : 'הפסדת!'}
        </motion.h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-gray-400 text-sm mb-6 relative z-10">
          {isWinner ? `כל הכבוד, ${winnerData?.displayName}!` : `${winnerData?.displayName} ניצח בדו-קרב`}
        </motion.p>

        {/* Final scoreboard */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
          className="flex gap-6 sm:gap-10 mb-8 relative z-10">
          {playerList.map(([uid, data]) => {
            const won = uid === room.winner
            return (
              <div key={uid} className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${won ? 'border-arena-gold/50 bg-arena-gold/5' : 'border-arena-border bg-arena-surface/60'}`}>
                <PlayerAvatar photoURL={data.photoURL} displayName={data.displayName} size="md" />
                <span className={`text-xs font-semibold ${won ? 'text-arena-gold' : 'text-gray-400'}`}>
                  {data.displayName}
                </span>
                <span className={`text-sm font-black ${won ? 'text-arena-gold' : 'text-gray-500'}`}>
                  {Math.ceil(data.timeLeft)}s
                </span>
                {won && <span className="text-xs text-arena-gold">🥇</span>}
              </div>
            )
          })}
        </motion.div>

        <motion.button initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          onClick={leaveGame}
          className={`relative z-10 font-black px-10 py-3 rounded-xl text-white text-lg transition-all ${
            isWinner
              ? 'bg-arena-gold shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:shadow-[0_0_32px_rgba(245,158,11,0.6)]'
              : 'bg-arena-neon shadow-neon'
          }`}>
          חזרה ללובי
        </motion.button>
      </motion.div>
    )
  }

  // ── Active game ─────────────────────────────────────────────────────────
  const {
    currentQuestionIndex,
    questions,
    players,
    currentTurn,
    isPrivate,
    code,
  } = room

  const playerList    = Object.entries(players || {})
  const currentQ      = questions?.[currentQuestionIndex]
  const isMyTurn      = currentTurn === user.uid
  const OPTION_LABELS = ['א', 'ב', 'ג', 'ד']

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="min-h-screen bg-arena-bg flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-arena-border px-4 py-2 flex items-center justify-between">
        <span className="text-gray-600 text-xs">
          שאלה {(currentQuestionIndex ?? 0) + 1}/{questions?.length ?? 10}
        </span>
        <h1 className="text-base font-black text-arena-neon">⚔️ הזירה</h1>
        <span className="text-gray-700 text-xs">{isPrivate ? `🔐 ${code}` : '🌐'}</span>
      </header>

      {/* ── Player timer bars ── */}
      <div className="bg-arena-surface border-b border-arena-border px-4 py-3">
        <div className="flex justify-around items-center max-w-lg mx-auto">
          {playerList.map(([uid, data]) => {
            const isActive = uid === currentTurn
            const displayedTime = timers[uid] ?? data.timeLeft
            const isMe = uid === user.uid

            return (
              <div key={uid}
                className={`flex flex-col items-center gap-1.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
                <div className="flex items-center gap-2">
                  {isActive && (
                    <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.9, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-arena-neon flex-shrink-0" />
                  )}
                  <PlayerAvatar photoURL={data.photoURL} displayName={data.displayName} />
                </div>
                <span className={`text-xs font-semibold max-w-[72px] truncate ${isMe ? 'text-arena-neon' : 'text-gray-300'}`}>
                  {data.displayName}{isMe && ' (אתה)'}
                </span>
                <TimerRing seconds={displayedTime} active={isActive} size={64} />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Turn banner ── */}
      <div className="py-1.5 text-center">
        {isMyTurn ? (
          <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
            className="text-arena-neon text-xs font-bold">
            ✨ התור שלך — ענה!
          </motion.span>
        ) : (
          <span className="text-gray-600 text-xs">
            ממתין לתשובת {players[currentTurn]?.displayName || 'היריב'}...
          </span>
        )}
      </div>

      {/* ── Question ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-4 gap-4">
        {currentQ ? (
          <AnimatePresence mode="wait">
            <motion.div key={currentQ.id}
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.3 }}
              className="bg-arena-surface border border-arena-border rounded-2xl p-5 w-full max-w-xl shadow-card">

              {/* Category */}
              <span className="text-xs text-arena-neon bg-purple-900/30 px-3 py-1 rounded-full border border-purple-800 inline-block mb-4">
                {currentQ.category || currentQ.topic}
              </span>

              {/* Question text */}
              <h2 className="text-lg sm:text-xl font-bold text-white leading-relaxed mb-5">
                {currentQ.question}
              </h2>

              {/* Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {currentQ.options.map((opt, idx) => {
                  let style = 'border-arena-border bg-arena-bg text-gray-300'
                  if (isMyTurn && !reveal) {
                    style = 'border-arena-border bg-arena-bg hover:border-arena-neon hover:bg-purple-900/20 cursor-pointer text-white'
                  } else if (reveal) {
                    if (opt === reveal) style = 'border-green-500 bg-green-900/30 text-green-300'
                    else style = 'border-arena-border bg-arena-bg opacity-40 text-gray-600'
                  }

                  return (
                    <motion.button key={opt}
                      onClick={() => isMyTurn && !reveal && handleAnswer(opt)}
                      whileHover={isMyTurn && !reveal ? { scale: 1.02 } : {}}
                      whileTap={isMyTurn && !reveal ? { scale: 0.98 } : {}}
                      className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 text-right transition-all text-sm font-medium ${style}`}>
                      <span className="w-7 h-7 rounded-lg bg-arena-surface border border-arena-border flex items-center justify-center text-xs font-black text-gray-500 flex-shrink-0">
                        {OPTION_LABELS[idx]}
                      </span>
                      <span className="flex-1">{opt}</span>
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="text-gray-600">טוען שאלה...</div>
        )}

        {/* Skip button */}
        {isMyTurn && !reveal && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={handleSkip} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            className="border border-arena-border text-gray-400 hover:border-red-500 hover:text-red-400 transition-all rounded-xl px-5 py-2 text-sm font-semibold flex items-center gap-2">
            <span>⚡ דלג</span>
            <span className="text-xs text-red-500/70">−{SKIP_PENALTY}s</span>
          </motion.button>
        )}
      </main>
    </motion.div>
  )
}

// Animated waiting dots
function WaitingDots({ label }) {
  const [dots, setDots] = useState('.')
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500)
    return () => clearInterval(t)
  }, [])
  return <h2 className="text-2xl font-black text-white mb-2">{label}{dots}</h2>
}
