import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  listenGame,
  setGameGenerating,
  updateGameWithQuestions,
  recordStrike,
  advanceTurn,
  endGame,
  cancelGame,
} from '../services/game'
import { generateQuestions } from '../services/gemini'
import { get, ref } from 'firebase/database'
import { rtdb } from '../firebase'
import QuestionCard from './QuestionCard'
import StrikeDisplay from './StrikeDisplay'

// ─────────────────────────────────────────────
// Cinematic loading screen
// ─────────────────────────────────────────────

const LOADING_MSGS = [
  'מייצר זירה...',
  'מרכיב שאלות...',
  'מכין את הדו-קרב...',
  'בוחר נושאים...',
  'מגדיר את הכללים...',
]

function GeneratingScreen() {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % LOADING_MSGS.length), 1800)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4">
      {/* spinning rings */}
      <div className="relative w-32 h-32 mb-10">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full border-4 border-t-arena-neon border-r-arena-neon border-b-transparent border-l-transparent"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-3 rounded-full border-2 border-b-arena-cyan border-l-arena-cyan border-t-transparent border-r-transparent"
        />
        <div className="absolute inset-0 flex items-center justify-center text-4xl">⚔️</div>
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={idx}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4 }}
          className="text-arena-neon text-xl font-bold neon-text mb-3"
        >
          {LOADING_MSGS[idx]}
        </motion.p>
      </AnimatePresence>

      <p className="text-gray-600 text-sm mb-6">הבינה המלאכותית מכינה שאלות ייחודיות</p>

      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            className="w-2 h-2 rounded-full bg-arena-neon"
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Waiting screen (before 2nd player joins)
// ─────────────────────────────────────────────

function WaitingScreen({ game, onCancel }) {
  const [dots, setDots] = useState('.')

  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? '.' : d + '.')), 500)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center">
      {/* pulsing ring */}
      <div className="relative mb-10">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-full bg-arena-neon/20"
        />
        <div className="relative w-28 h-28 rounded-full border-4 border-arena-neon flex items-center justify-center text-5xl shadow-neon">
          ⚔️
        </div>
      </div>

      {game.isPrivate && game.code ? (
        <>
          <p className="text-gray-400 text-sm mb-2">קוד החדר שלך</p>
          <motion.div
            animate={{ boxShadow: [
              '0 0 10px rgba(6,182,212,0.3)',
              '0 0 30px rgba(6,182,212,0.7)',
              '0 0 10px rgba(6,182,212,0.3)',
            ]}}
            transition={{ duration: 2, repeat: Infinity }}
            className="bg-arena-surface border-2 border-arena-cyan rounded-2xl px-8 py-4 mb-6"
          >
            <span className="text-arena-cyan font-black text-4xl tracking-[0.25em] font-mono dir-ltr">
              {game.code}
            </span>
          </motion.div>
          <p className="text-gray-400 text-sm mb-8">
            שתף את הקוד עם חברך כדי שיצטרף לחדר
          </p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-black text-white mb-2">
            מחפש יריב{dots}
          </h2>
          <p className="text-gray-500 mb-8">
            ממתין לשחקן שני — המשחק יתחיל אוטומטית
          </p>
        </>
      )}

      <button
        onClick={onCancel}
        className="text-gray-500 hover:text-red-400 transition-colors text-sm underline"
      >
        ביטול וחזרה ללובי
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
// Player card in game header
// ─────────────────────────────────────────────

function PlayerCard({ data, isTurn, isMe }) {
  return (
    <div className={`flex flex-col items-center gap-2 transition-opacity ${isTurn ? 'opacity-100' : 'opacity-50'}`}>
      <div className="relative">
        {data.photoURL ? (
          <img
            src={data.photoURL}
            referrerPolicy="no-referrer"
            alt={data.displayName}
            className={`w-12 h-12 rounded-full object-cover border-2 ${isMe ? 'border-arena-neon' : 'border-gray-500'}`}
          />
        ) : (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg border-2 bg-arena-bg ${isMe ? 'border-arena-neon text-arena-neon' : 'border-gray-500 text-gray-400'}`}>
            {data.displayName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        {isTurn && (
          <motion.div
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
            className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-arena-neon border-2 border-arena-bg"
          />
        )}
      </div>
      <span className={`text-xs font-semibold max-w-[80px] truncate ${isMe ? 'text-arena-neon' : 'text-gray-300'}`}>
        {data.displayName}{isMe && ' (אתה)'}
      </span>
      <StrikeDisplay strikes={data.strikes} />
    </div>
  )
}

// ─────────────────────────────────────────────
// Main GameRoom
// ─────────────────────────────────────────────

export default function GameRoom() {
  const { gameId }          = useParams()
  const { user }            = useAuth()
  const navigate            = useNavigate()
  const [game, setGame]     = useState(null)
  const [reveal, setReveal] = useState(null)
  const processingRef       = useRef(false)
  const generatingRef       = useRef(false)

  // ── Listen to game state ──
  useEffect(() => {
    const unsub = listenGame(gameId, (data) => {
      if (!data) return navigate('/')
      setGame(data)
    })
    return unsub
  }, [gameId, navigate])

  // ── Host: when 2nd player joins, trigger Gemini ──
  useEffect(() => {
    if (!game) return
    if (game.hostUid !== user.uid) return
    if (game.status !== 'waiting') return
    if (Object.keys(game.players || {}).length < 2) return
    if (generatingRef.current) return

    generatingRef.current = true

    setGameGenerating(gameId)
      .then(() => generateQuestions())
      .then((qs) => updateGameWithQuestions(gameId, qs))
      .catch((err) => {
        console.error('Gemini error:', err)
        generatingRef.current = false  // allow retry on next render
      })
  }, [game, gameId, user.uid])

  // ── Reset reveal when question index changes ──
  useEffect(() => {
    setReveal(null)
    processingRef.current = false
  }, [game?.currentQuestionIndex])

  // ── Answer handler ──
  const processAnswer = useCallback(async (selectedOption) => {
    if (!game || processingRef.current) return
    processingRef.current = true

    const { currentQuestionIndex, questions, players } = game
    const question   = questions?.[currentQuestionIndex]
    if (!question) { processingRef.current = false; return }

    const isCorrect  = selectedOption !== null && selectedOption === question.correct
    const playerUids = Object.keys(players)

    try {
      // Record strike if wrong and check for KO
      if (!isCorrect) {
        const tx = await recordStrike(gameId, user.uid)
        const newStrikes = tx.snapshot.val()

        if (newStrikes >= 3) {
          const winner = playerUids.find((u) => u !== user.uid) || user.uid
          await endGame(gameId, winner)
          return   // processingRef reset by useEffect above
        }
      }

      // Show reveal locally, then advance
      setReveal(question.correct)

      const nextIndex   = currentQuestionIndex + 1
      const myPos       = playerUids.indexOf(user.uid)
      const nextTurnUid = playerUids[(myPos + 1) % playerUids.length]

      setTimeout(async () => {
        try {
          if (nextIndex >= questions.length) {
            // All questions done — winner has fewest strikes
            const snap    = await get(ref(rtdb, `games/${gameId}/players`))
            const latest  = snap.val() || players
            const winner  = Object.entries(latest)
              .sort(([, a], [, b]) => a.strikes - b.strikes)[0][0]
            await endGame(gameId, winner)
          } else {
            await advanceTurn(gameId, nextIndex, nextTurnUid)
          }
        } catch (err) {
          console.error('advanceTurn error:', err)
          processingRef.current = false
        }
      }, 1600)
    } catch (err) {
      console.error('processAnswer error:', err)
      processingRef.current = false
    }
  }, [game, gameId, user.uid])

  // ── Cancel / leave waiting room ──
  async function handleCancel() {
    await cancelGame(gameId, game?.code, user.uid)
    navigate('/')
  }

  // ─────────── Render states ───────────

  if (!game) {
    return (
      <div className="min-h-screen bg-arena-bg flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-arena-neon border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (game.status === 'waiting') {
    return <WaitingScreen game={game} onCancel={handleCancel} />
  }

  if (game.status === 'generating') {
    return <GeneratingScreen />
  }

  const {
    currentQuestionIndex,
    questions,
    players,
    status,
    winner,
    currentTurn,
    mode,
    isPrivate,
  } = game

  const playerList     = Object.entries(players || {})
  const currentQ       = questions?.[currentQuestionIndex]
  const isMyTurn       = currentTurn === user.uid

  // ─────────── Game over ───────────
  if (status === 'finished') {
    const isWinner   = winner === user.uid
    const winnerData = players?.[winner]

    const SPARKLES = ['🏆', '✨', '⭐', '🌟', '💫', '🎉']

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center relative overflow-hidden"
      >
        {/* Ambient background glow */}
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.08, 0.22, 0.08] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className={`absolute w-[500px] h-[500px] rounded-full blur-3xl pointer-events-none ${
            isWinner ? 'bg-arena-gold' : 'bg-red-600'
          }`}
        />

        {/* Floating sparkles — winner only */}
        {isWinner && SPARKLES.map((emoji, i) => (
          <motion.span
            key={i}
            initial={{ y: 120, opacity: 0, x: 0 }}
            animate={{ y: -180, opacity: [0, 1, 1, 0], x: (i % 2 === 0 ? 1 : -1) * (10 + i * 8) }}
            transition={{
              delay: i * 0.18,
              duration: 2.2,
              repeat: Infinity,
              repeatDelay: 0.6,
              ease: 'easeOut',
            }}
            className="absolute text-2xl pointer-events-none select-none"
            style={{ left: `${12 + i * 14}%` }}
          >
            {emoji}
          </motion.span>
        ))}

        {/* Main emoji */}
        <motion.div
          initial={{ scale: 0, rotate: isWinner ? -30 : 0, y: 40 }}
          animate={{ scale: 1, rotate: 0, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
          className="text-8xl sm:text-9xl mb-4 relative z-10 select-none"
        >
          {isWinner ? '🏆' : '💀'}
        </motion.div>

        {/* Title */}
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="relative z-10 mb-2"
        >
          <h1 className={`text-5xl sm:text-6xl font-black mb-2 ${isWinner ? 'text-arena-gold neon-text' : 'text-red-400'}`}>
            {isWinner ? 'ניצחת!' : 'הפסדת!'}
          </h1>
          {isWinner && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-gray-300 text-sm"
            >
              כל הכבוד, {winnerData?.displayName || 'לוחם'}! 🎖️
            </motion.p>
          )}
          {!isWinner && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-gray-500 text-sm"
            >
              {winnerData?.displayName || 'היריב'} ניצח בדו-קרב
            </motion.p>
          )}
        </motion.div>

        {/* Final scoreboard */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="flex gap-8 sm:gap-12 my-6 relative z-10"
        >
          {playerList.map(([uid, data]) => {
            const isThisWinner = uid === winner
            return (
              <div key={uid} className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${isThisWinner ? 'border-arena-gold/40 bg-arena-gold/5' : 'border-arena-border bg-arena-surface/60'}`}>
                {data.photoURL ? (
                  <img
                    src={data.photoURL}
                    referrerPolicy="no-referrer"
                    alt=""
                    className={`w-12 h-12 rounded-full border-2 ${isThisWinner ? 'border-arena-gold' : 'border-gray-600'}`}
                  />
                ) : (
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold border-2 bg-arena-bg ${isThisWinner ? 'border-arena-gold text-arena-gold' : 'border-gray-600 text-gray-400'}`}>
                    {data.displayName?.[0]?.toUpperCase()}
                  </div>
                )}
                <span className={`text-xs font-semibold ${isThisWinner ? 'text-arena-gold' : 'text-gray-400'}`}>
                  {data.displayName}
                </span>
                <StrikeDisplay strikes={data.strikes} />
                {isThisWinner && <span className="text-xs text-arena-gold font-bold">🥇 מנצח</span>}
              </div>
            )
          })}
        </motion.div>

        {/* Back button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => navigate('/')}
          className={`relative z-10 font-black px-10 py-3 rounded-xl text-white text-lg ${
            isWinner
              ? 'bg-arena-gold shadow-[0_0_20px_rgba(245,158,11,0.5)] hover:shadow-[0_0_30px_rgba(245,158,11,0.7)]'
              : 'bg-arena-neon shadow-neon'
          } transition-all`}
        >
          חזרה ללובי
        </motion.button>
      </motion.div>
    )
  }

  // ─────────── Active game ───────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-arena-bg flex flex-col"
    >
      {/* Header */}
      <header className="border-b border-arena-border px-4 py-3 flex items-center justify-between">
        <span className="text-gray-500 text-xs">
          שאלה {(currentQuestionIndex ?? 0) + 1}/{questions?.length ?? 10}
        </span>
        <h1 className="text-lg font-black text-arena-neon">⚔️ הזירה</h1>
        <span className="text-xs text-gray-600 uppercase">
          {isPrivate ? `🔐 ${game.code}` : '🌐 אקראי'}
        </span>
      </header>

      {/* Players */}
      <div className="flex justify-around items-start px-6 py-4 bg-arena-surface border-b border-arena-border">
        {playerList.map(([uid, data]) => (
          <PlayerCard
            key={uid}
            data={data}
            isTurn={uid === currentTurn}
            isMe={uid === user.uid}
          />
        ))}
      </div>

      {/* Turn banner */}
      <div className="py-2 text-center">
        {isMyTurn ? (
          <motion.span
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="text-arena-neon text-sm font-bold"
          >
            ✨ התור שלך — ענה!
          </motion.span>
        ) : (
          <span className="text-gray-600 text-sm">
            ממתין לתשובת {players[currentTurn]?.displayName || 'היריב'}...
          </span>
        )}
      </div>

      {/* Question */}
      <main className="flex-1 flex items-center justify-center px-4 py-4">
        <QuestionCard
          question={currentQ}
          onAnswer={isMyTurn && !processingRef.current ? processAnswer : null}
          disabled={!isMyTurn}
          revealAnswer={reveal}
        />
      </main>
    </motion.div>
  )
}
