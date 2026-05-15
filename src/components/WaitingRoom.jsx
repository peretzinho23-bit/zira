import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  joinQueue,
  leaveQueue,
  listenQueue,
  listenMyQueueEntry,
  createGame,
  cleanupMatchmaking,
  updateGameWithQuestions,
} from '../services/game'
import { generateQuestions } from '../services/gemini'

const REQUIRED    = { '1v1': 2, '2v2': 4 }
const MODE_LABELS = { '1v1': '1 נגד 1', '2v2': '2 נגד 2' }

export default function WaitingRoom() {
  const { mode }          = useParams()
  const { user }          = useAuth()
  const navigate          = useNavigate()
  const [queue, setQueue] = useState([])
  const [dots, setDots]   = useState('.')
  const gameCreatedRef    = useRef(false)

  const needed = REQUIRED[mode] || 2

  // Animated dots
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? '.' : d + '.')), 500)
    return () => clearInterval(t)
  }, [])

  // Join queue on mount, leave on unmount
  useEffect(() => {
    joinQueue(mode, user.uid, user.displayName || 'לוחם', user.photoURL || null)
    const unsub = listenQueue(mode, (entries) => setQueue(entries))
    return () => {
      unsub()
      leaveQueue(mode, user.uid)
    }
  }, [mode, user])

  // Non-creator: watch for gameId in my queue entry
  useEffect(() => {
    const unsub = listenMyQueueEntry(mode, user.uid, (entry) => {
      if (entry?.gameId && !gameCreatedRef.current) {
        gameCreatedRef.current = true
        navigate(`/game/${entry.gameId}`)
      }
    })
    return unsub
  }, [mode, user.uid, navigate])

  // Creator: when enough players arrive, create game + generate questions
  useEffect(() => {
    if (queue.length < needed || gameCreatedRef.current) return
    const sorted = [...queue].sort(([a], [b]) => a.localeCompare(b))
    if (sorted[0][0] !== user.uid) return

    gameCreatedRef.current = true

    const uids      = sorted.slice(0, needed).map(([uid]) => uid)
    const names     = sorted.slice(0, needed).map(([, d]) => d.displayName)
    const photos    = sorted.slice(0, needed).map(([, d]) => d.photoURL || null)

    createGame(mode, uids, names, photos).then(async (gameId) => {
      cleanupMatchmaking(mode, uids)
      navigate(`/game/${gameId}`)
      // Generate questions asynchronously — GameRoom shows loading screen in the meantime
      try {
        const questions = await generateQuestions()
        await updateGameWithQuestions(gameId, questions)
      } catch (err) {
        console.error('Gemini error:', err)
        // Retry once
        try {
          const questions = await generateQuestions()
          await updateGameWithQuestions(gameId, questions)
        } catch {
          // Update with error status so GameRoom can show a retry option
          await updateGameWithQuestions(gameId, null).catch(() => {})
        }
      }
    })
  }, [queue, needed, mode, user.uid, navigate])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4"
    >
      {/* Pulsing arena ring */}
      <div className="relative mb-10">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-full bg-arena-neon/20"
        />
        <div className="relative w-24 h-24 rounded-full border-4 border-arena-neon flex items-center justify-center text-4xl shadow-neon">
          ⚔️
        </div>
      </div>

      <h2 className="text-3xl font-black text-white mb-2">
        מצב: <span className="text-arena-neon">{MODE_LABELS[mode]}</span>
      </h2>
      <p className="text-gray-400 mb-8">מחפש יריבים{dots}</p>

      {/* Player slots */}
      <div className="w-full max-w-sm space-y-3 mb-8">
        {Array.from({ length: needed }).map((_, i) => {
          const player = queue[i]
          const photo  = player?.[1]?.photoURL
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                player
                  ? 'border-arena-neon bg-purple-900/20'
                  : 'border-arena-border bg-arena-surface'
              }`}
            >
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-arena-neon object-cover flex-shrink-0"
                />
              ) : (
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  player
                    ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]'
                    : 'bg-gray-600'
                }`} />
              )}
              <span className={`font-semibold flex-1 ${player ? 'text-white' : 'text-gray-600'}`}>
                {player ? player[1].displayName : `שחקן ${i + 1}`}
              </span>
              {player && <span className="text-xs text-green-400">מחובר</span>}
            </motion.div>
          )
        })}
      </div>

      <p className="text-gray-500 text-sm mb-6">{queue.length}/{needed} שחקנים</p>

      <button
        onClick={() => navigate('/')}
        className="text-gray-500 hover:text-red-400 transition-colors text-sm underline"
      >
        ביטול וחזרה ללובי
      </button>
    </motion.div>
  )
}
