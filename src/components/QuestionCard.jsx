import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const OPTION_LETTERS = ['א', 'ב', 'ג', 'ד']

export default function QuestionCard({
  question,
  onAnswer,
  disabled = false,
  revealAnswer = null,
  timeLimit = 20,
}) {
  const [selected, setSelected] = useState(null)
  const [timeLeft, setTimeLeft] = useState(timeLimit)

  useEffect(() => {
    setSelected(null)
    setTimeLeft(timeLimit)
  }, [question?.id, timeLimit])

  useEffect(() => {
    if (disabled || revealAnswer || selected) return
    if (timeLeft <= 0) {
      onAnswer && onAnswer(null)
      return
    }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000)
    return () => clearTimeout(t)
  }, [timeLeft, disabled, revealAnswer, selected, onAnswer])

  function handleSelect(option) {
    if (disabled || selected || revealAnswer) return
    setSelected(option)
    onAnswer && onAnswer(option)
  }

  function getOptionStyle(option) {
    if (!revealAnswer && !selected) {
      return 'border-arena-border bg-arena-surface hover:border-arena-neon hover:bg-purple-900/20 cursor-pointer'
    }
    if (option === revealAnswer || option === question?.correct) {
      return 'border-green-500 bg-green-900/30 text-green-300'
    }
    if (option === selected && option !== question?.correct) {
      return 'border-red-500 bg-red-900/30 text-red-300'
    }
    return 'border-arena-border bg-arena-surface opacity-40'
  }

  const timerPct = (timeLeft / timeLimit) * 100
  const timerColor =
    timeLeft > 10 ? 'bg-arena-neon' : timeLeft > 5 ? 'bg-yellow-400' : 'bg-red-500'

  if (!question) return null

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question.id}
        initial={{ opacity: 0, x: 60 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -60 }}
        transition={{ duration: 0.35 }}
        className="bg-arena-surface border border-arena-border rounded-2xl p-6 shadow-card w-full max-w-2xl mx-auto"
      >
        {/* Category + Timer */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-arena-neon bg-purple-900/30 px-3 py-1 rounded-full border border-purple-800">
            {question.category}
          </span>
          {!disabled && (
            <span className={`text-lg font-black ${timeLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-gray-300'}`}>
              {timeLeft}s
            </span>
          )}
        </div>

        {/* Timer bar */}
        {!disabled && (
          <div className="w-full h-1 bg-arena-border rounded-full mb-5 overflow-hidden">
            <motion.div
              className={`h-full ${timerColor} rounded-full`}
              style={{ width: `${timerPct}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        )}

        {/* Question text */}
        <h2 className="text-xl font-bold text-white leading-relaxed mb-6">
          {question.question}
        </h2>

        {/* Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {question.options.map((option, idx) => (
            <motion.button
              key={option}
              onClick={() => handleSelect(option)}
              whileHover={!disabled && !selected && !revealAnswer ? { scale: 1.02 } : {}}
              whileTap={!disabled && !selected && !revealAnswer ? { scale: 0.98 } : {}}
              className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 text-right transition-all text-sm font-medium ${getOptionStyle(option)}`}
            >
              <span className="w-7 h-7 rounded-lg bg-arena-bg border border-arena-border flex items-center justify-center text-xs font-black text-gray-400 flex-shrink-0">
                {OPTION_LETTERS[idx]}
              </span>
              <span className="flex-1">{option}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
