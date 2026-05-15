import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { generateQuestions } from '../services/gemini'
import QuestionCard from './QuestionCard'
import StrikeDisplay from './StrikeDisplay'

const MAX_STRIKES   = 3
const BOT_DELAY_MIN = 1200
const BOT_DELAY_MAX = 3500
const BOT_ACCURACY  = 0.65

const LOADING_MESSAGES = [
  'מייצר זירה...',
  'מרכיב שאלות...',
  'מכין יריב בינה מלאכותית...',
  'בוחר נושאים...',
  'מכין את הדו-קרב...',
]

function GeneratingScreen({ error, onRetry }) {
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    if (error) return
    const t = setInterval(
      () => setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length),
      1800
    )
    return () => clearInterval(t)
  }, [error])

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center gap-6"
      >
        <div className="text-5xl">⚠️</div>
        <p className="text-red-400 font-bold text-lg">שגיאה בטעינת השאלות</p>
        <p className="text-gray-500 text-sm">{error}</p>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRetry}
          className="bg-arena-neon text-white font-bold px-6 py-3 rounded-xl shadow-neon"
        >
          נסה שוב
        </motion.button>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4"
    >
      <div className="relative w-32 h-32 mb-10">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full border-4 border-t-arena-neon border-r-arena-neon border-b-transparent border-l-transparent"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-3 rounded-full border-2 border-t-transparent border-r-arena-cyan border-b-arena-cyan border-l-transparent"
        />
        <div className="absolute inset-0 flex items-center justify-center text-4xl">🤖</div>
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={msgIndex}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4 }}
          className="text-arena-neon text-xl font-bold neon-text mb-3"
        >
          {LOADING_MESSAGES[msgIndex]}
        </motion.p>
      </AnimatePresence>

      <p className="text-gray-600 text-sm">הבינה המלאכותית מכינה שאלות ייחודיות</p>

      <div className="flex gap-2 mt-6">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            className="w-2 h-2 rounded-full bg-arena-neon"
          />
        ))}
      </div>
    </motion.div>
  )
}

export default function BotGame() {
  const navigate = useNavigate()

  const [questions, setQuestions]    = useState(null)
  const [genError, setGenError]      = useState(null)
  const [qIndex, setQIndex]          = useState(0)
  const [playerStrikes, setPS]       = useState(0)
  const [botStrikes, setBS]          = useState(0)
  const [playerScore, setPScore]     = useState(0)
  const [botScore, setBScore]        = useState(0)
  const [reveal, setReveal]          = useState(null)
  const [status, setStatus]          = useState('playing')
  const [winner, setWinner]          = useState(null)
  const [botThinking, setBotThink]   = useState(false)
  const loadingRef = useRef(false)

  const loadQuestions = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setGenError(null)
    setQuestions(null)
    try {
      const qs = await generateQuestions()
      setQuestions(qs)
    } catch (err) {
      setGenError(err.message || 'שגיאה לא ידועה')
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => { loadQuestions() }, [loadQuestions])

  const currentQ = questions?.[qIndex]

  const finishGame = useCallback((pS, bS, pSc, bSc) => {
    setStatus('finished')
    if (pS >= MAX_STRIKES) setWinner('bot')
    else if (bS >= MAX_STRIKES) setWinner('player')
    else setWinner(pSc >= bSc ? 'player' : 'bot')
  }, [])

  const handlePlayerAnswer = useCallback((selected) => {
    if (status !== 'playing' || !currentQ) return

    const isRight  = selected === currentQ.correct
    const newPS    = isRight ? playerStrikes : playerStrikes + 1
    const newPSc   = isRight ? playerScore + 1 : playerScore
    setPS(newPS)
    setPScore(newPSc)
    setReveal(currentQ.correct)

    setBotThink(true)
    const delay = BOT_DELAY_MIN + Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN)

    setTimeout(() => {
      setBotThink(false)
      const botRight = Math.random() < BOT_ACCURACY
      const newBS    = botRight ? botStrikes : botStrikes + 1
      const newBSc   = botRight ? botScore + 1 : botScore
      setBS(newBS)
      setBScore(newBSc)

      const nextIdx = qIndex + 1
      if (newPS >= MAX_STRIKES || newBS >= MAX_STRIKES || nextIdx >= questions.length) {
        finishGame(newPS, newBS, newPSc, newBSc)
      } else {
        setTimeout(() => {
          setReveal(null)
          setQIndex(nextIdx)
        }, 800)
      }
    }, delay)
  }, [status, currentQ, playerStrikes, botStrikes, playerScore, botScore, qIndex, questions, finishGame])

  // ---- Loading / Error ----
  if (!questions) {
    return <GeneratingScreen error={genError} onRetry={loadQuestions} />
  }

  // ---- Game over ----
  if (status === 'finished') {
    const isWin = winner === 'player'
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="min-h-screen bg-arena-bg flex flex-col items-center justify-center px-4 text-center"
      >
        <div className="text-8xl mb-6">{isWin ? '🏆' : '🤖'}</div>
        <h1 className={`text-4xl font-black mb-2 ${isWin ? 'text-arena-gold' : 'text-arena-cyan'}`}>
          {isWin ? 'ניצחת את הבוט!' : 'הבוט ניצח!'}
        </h1>
        <div className="flex gap-10 my-6">
          <div>
            <p className="text-gray-400 text-xs mb-1">הניקוד שלך</p>
            <p className="text-4xl font-black text-arena-neon">{playerScore}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">ניקוד הבוט</p>
            <p className="text-4xl font-black text-arena-cyan">{botScore}</p>
          </div>
        </div>
        <div className="flex gap-4 mt-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setQuestions(null); setQIndex(0); setPS(0); setBS(0)
              setPScore(0); setBScore(0); setReveal(null)
              setStatus('playing'); setWinner(null)
              loadQuestions()
            }}
            className="bg-arena-neon text-white font-bold px-6 py-3 rounded-xl shadow-neon"
          >
            שחק שוב
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/')}
            className="border border-arena-border text-gray-300 font-bold px-6 py-3 rounded-xl hover:border-arena-neon transition-colors"
          >
            לובי
          </motion.button>
        </div>
      </motion.div>
    )
  }

  // ---- Active game ----
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-arena-bg flex flex-col"
    >
      <header className="border-b border-arena-border px-4 py-3 flex items-center justify-between">
        <span className="text-gray-500 text-sm">שאלה {qIndex + 1}/{questions.length}</span>
        <h1 className="text-xl font-black text-arena-neon">🤖 נגד הבוט</h1>
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 hover:text-red-400 text-sm transition-colors"
        >
          ✕ יציאה
        </button>
      </header>

      <div className="flex justify-around px-4 py-4 bg-arena-surface border-b border-arena-border">
        <StrikeDisplay strikes={playerStrikes} label="אתה" />
        <div className="text-gray-600 text-xl font-black self-center">VS</div>
        <StrikeDisplay strikes={botStrikes} label="בוט 🤖" />
      </div>

      {botThinking && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-2 text-sm text-arena-cyan"
        >
          הבוט חושב...
        </motion.div>
      )}

      <main className="flex-1 flex items-center justify-center px-4 py-4">
        <QuestionCard
          question={currentQ}
          onAnswer={handlePlayerAnswer}
          disabled={!!reveal || botThinking}
          revealAnswer={reveal}
        />
      </main>
    </motion.div>
  )
}
