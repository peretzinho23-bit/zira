import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { loginWithGoogle } from '../../services/auth'
import ArenaFooter from '../Footer'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const navigate = useNavigate()

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      await loginWithGoogle()
      navigate('/')
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError('שגיאה בהתחברות. נסה שוב.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-arena-bg flex flex-col items-center justify-between px-4 py-8"
    >
      <div className="w-full max-w-sm flex flex-col items-center flex-1 justify-center">

        {/* Logo */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="text-center mb-10"
        >
          <motion.h1
            className="text-6xl sm:text-7xl font-black text-arena-neon neon-text tracking-wider mb-3"
            animate={{ textShadow: [
              '0 0 10px rgba(168,85,247,0.6)',
              '0 0 30px rgba(168,85,247,1)',
              '0 0 10px rgba(168,85,247,0.6)',
            ]}}
            transition={{ duration: 3, repeat: Infinity }}
          >
            ⚔️ הזירה
          </motion.h1>
          <p className="text-gray-400 text-base tracking-widest uppercase">
            Developed by Peretzinho
          </p>
        </motion.div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-gray-300 text-base sm:text-lg text-center mb-10 leading-relaxed"
        >
          הוכח את עצמך בדו-קרב החידות.<br />
          <span className="text-arena-neon font-semibold">שלושה מכות — אתה בחוץ.</span>
        </motion.p>

        {/* Google button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="w-full"
        >
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-400 text-sm text-center mb-4"
            >
              {error}
            </motion.p>
          )}

          <motion.button
            onClick={handleGoogle}
            disabled={loading}
            whileHover={{ scale: 1.03, boxShadow: '0 0 30px rgba(168,85,247,0.5)' }}
            whileTap={{ scale: 0.97 }}
            className="w-full flex items-center justify-center gap-4 bg-arena-surface border-2 border-arena-neon rounded-2xl px-6 py-4 text-white font-bold text-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-neon"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>מתחבר...</span>
              </>
            ) : (
              <>
                {/* Google logo SVG */}
                <svg width="24" height="24" viewBox="0 0 24 24" className="flex-shrink-0">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>כניסה עם Google</span>
              </>
            )}
          </motion.button>
        </motion.div>

      </div>
      <ArenaFooter />
    </motion.div>
  )
}
