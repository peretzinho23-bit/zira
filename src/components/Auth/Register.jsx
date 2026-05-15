import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { register } from '../../services/auth'

function getHebrewError(code) {
  const map = {
    'auth/email-already-in-use': 'כתובת הדוא"ל כבר בשימוש',
    'auth/invalid-email':        'כתובת דוא"ל לא תקינה',
    'auth/weak-password':        'הסיסמה חלשה מדי',
  }
  return map[code] || 'שגיאה בהרשמה. נסה שוב'
}

export default function Register() {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('הסיסמאות אינן תואמות')
    if (password.length < 6)  return setError('הסיסמה חייבת להכיל לפחות 6 תווים')
    setLoading(true)
    try {
      await register(email, password, displayName)
      navigate('/')
    } catch (err) {
      setError(getHebrewError(err.code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen bg-arena-bg flex items-center justify-center px-4"
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-6xl font-black neon-text text-arena-neon tracking-wider mb-2">
            ⚔️ הזירה
          </h1>
          <p className="text-gray-400 text-sm">הצטרף לזירה</p>
        </div>

        <motion.div className="bg-arena-surface border border-arena-border rounded-2xl p-8 shadow-card neon-border">
          <h2 className="text-2xl font-bold text-white mb-6">יצירת חשבון</h2>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-red-900/40 border border-red-500/50 text-red-300 rounded-lg p-3 mb-4 text-sm"
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm mb-1">שם תצוגה</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="w-full bg-arena-bg border border-arena-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-arena-neon transition-all"
                placeholder="הכינוי שלך בזירה"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm mb-1">דוא"ל</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                className="w-full bg-arena-bg border border-arena-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-arena-neon transition-all"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm mb-1">סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                dir="ltr"
                className="w-full bg-arena-bg border border-arena-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-arena-neon transition-all"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm mb-1">אימות סיסמה</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                dir="ltr"
                className="w-full bg-arena-bg border border-arena-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-arena-neon transition-all"
                placeholder="••••••••"
              />
            </div>

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full bg-arena-neon text-white font-bold py-3 rounded-lg mt-2 hover:bg-purple-400 transition-colors shadow-neon disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'נרשם...' : 'הרשמה לזירה'}
            </motion.button>
          </form>

          <p className="text-center text-gray-400 mt-6 text-sm">
            יש לך חשבון?{' '}
            <Link to="/login" className="text-arena-neon hover:underline">
              כניסה
            </Link>
          </p>
        </motion.div>

        <p className="text-center text-gray-600 text-xs mt-6">Developed by Peretzinho</p>
      </div>
    </motion.div>
  )
}
