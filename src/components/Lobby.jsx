import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { logout } from '../services/auth'
import {
  findOrCreateRandomGame,
  createPrivateGame,
  joinPrivateGame,
} from '../services/game'
import ArenaFooter from './Footer'

function PlayerAvatar({ user, size = 'md' }) {
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : 'w-9 h-9 text-sm'
  if (user?.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName}
        referrerPolicy="no-referrer"
        className={`${sz} rounded-full border-2 border-arena-neon object-cover shadow-neon`}
      />
    )
  }
  return (
    <div className={`${sz} rounded-full border-2 border-arena-neon bg-arena-surface flex items-center justify-center text-arena-neon font-bold`}>
      {user?.displayName?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

export default function Lobby() {
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const [view, setView]         = useState('main')   // 'main' | 'join'
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const name  = user?.displayName || 'לוחם'
  const photo = user?.photoURL    || null

  async function handleRandom() {
    setLoading(true)
    setError('')
    try {
      const gameId = await findOrCreateRandomGame(user.uid, name, photo)
      navigate(`/game/${gameId}`)
    } catch (err) {
      setError('שגיאה בחיפוש משחק. נסה שוב.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreatePrivate() {
    setLoading(true)
    setError('')
    try {
      const { gameId } = await createPrivateGame(user.uid, name, photo)
      navigate(`/game/${gameId}`)
    } catch (err) {
      setError('שגיאה ביצירת חדר. נסה שוב.')
    } finally {
      setLoading(false)
    }
  }

  async function handleJoinPrivate(e) {
    e.preventDefault()
    if (joinCode.trim().length !== 7) {
      setError('הקוד חייב להיות בדיוק 7 תווים')
      return
    }
    setLoading(true)
    setError('')
    try {
      const gameId = await joinPrivateGame(joinCode, user.uid, name, photo)
      navigate(`/game/${gameId}`)
    } catch (err) {
      setError(err.message || 'שגיאה בהצטרפות לחדר')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-arena-bg flex flex-col"
    >
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-arena-border gap-2">
        <button
          onClick={() => logout().then(() => navigate('/login'))}
          className="text-gray-500 hover:text-red-400 transition-colors text-xs sm:text-sm flex-shrink-0"
        >
          יציאה ↩
        </button>

        <h1 className="text-2xl sm:text-3xl font-black text-arena-neon neon-text">⚔️ הזירה</h1>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-arena-neon font-bold text-xs sm:text-sm max-w-[80px] truncate hidden xs:block">
            {name}
          </span>
          <PlayerAvatar user={user} />
        </div>
      </header>

      {/* ---- Main ---- */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 gap-8">

        {/* Welcome block */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h2 className="text-4xl font-black text-white mb-2">בחר מצב משחק</h2>
          <p className="text-gray-500">3 פסילות — אתה בחוץ</p>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-red-900/40 border border-red-500/50 text-red-300 rounded-lg px-4 py-3 text-sm"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-full max-w-md space-y-4">

          {/* Random game card */}
          <motion.button
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            onClick={handleRandom}
            disabled={loading}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="w-full bg-arena-surface border-2 border-arena-neon rounded-2xl p-6 flex items-center gap-5 hover:shadow-neon transition-all disabled:opacity-50 disabled:cursor-not-allowed text-right"
          >
            <div className="text-5xl flex-shrink-0">⚔️</div>
            <div className="flex-1">
              <p className="text-arena-neon font-black text-xl">משחק אקראי</p>
              <p className="text-gray-400 text-sm mt-1">
                המערכת תחבר אותך לשחקן זמין — הדו-קרב מתחיל מיד
              </p>
            </div>
            <span className="text-gray-500 text-xl">←</span>
          </motion.button>

          {/* Private game section */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-arena-surface border-2 border-arena-cyan rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center gap-4">
              <div className="text-5xl flex-shrink-0">🔐</div>
              <div>
                <p className="text-arena-cyan font-black text-xl">חדר פרטי</p>
                <p className="text-gray-400 text-sm mt-1">שחק מול חבר עם קוד ייחודי</p>
              </div>
            </div>

            <div className="flex gap-3">
              {/* Create private room */}
              <motion.button
                onClick={handleCreatePrivate}
                disabled={loading}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex-1 bg-arena-cyan/10 border border-arena-cyan text-arena-cyan font-bold py-3 rounded-xl text-sm hover:bg-arena-cyan/20 transition-all disabled:opacity-50"
              >
                צור חדר
              </motion.button>

              {/* Join private room */}
              <motion.button
                onClick={() => { setView(v => v === 'join' ? 'main' : 'join'); setError('') }}
                disabled={loading}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`flex-1 border font-bold py-3 rounded-xl text-sm transition-all disabled:opacity-50 ${
                  view === 'join'
                    ? 'bg-arena-cyan text-white border-arena-cyan'
                    : 'bg-transparent text-gray-300 border-arena-border hover:border-arena-cyan'
                }`}
              >
                הצטרף לחדר
              </motion.button>
            </div>

            {/* Code input */}
            <AnimatePresence>
              {view === 'join' && (
                <motion.form
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  onSubmit={handleJoinPrivate}
                  className="flex gap-2 overflow-hidden"
                >
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={7}
                    dir="ltr"
                    placeholder="XKQPLMZ"
                    className="flex-1 bg-arena-bg border border-arena-border rounded-xl px-4 py-3 text-white text-center tracking-[0.3em] font-mono font-bold text-lg uppercase focus:outline-none focus:border-arena-cyan transition-all placeholder-gray-700"
                  />
                  <motion.button
                    type="submit"
                    disabled={loading || joinCode.length !== 7}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="bg-arena-cyan text-white font-bold px-5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? '...' : 'כנס'}
                  </motion.button>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>

        </div>
      </main>

      <ArenaFooter />
    </motion.div>
  )
}
