import React from 'react'
import { motion } from 'framer-motion'

export default function StrikeDisplay({ strikes, maxStrikes = 3, label = '' }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {label && <span className="text-gray-400 text-xs">{label}</span>}
      <div className="flex gap-2">
        {Array.from({ length: maxStrikes }).map((_, i) => (
          <motion.div
            key={i}
            animate={i < strikes ? { scale: [1, 1.4, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold
              ${i < strikes
                ? 'bg-red-600 border-red-400 text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]'
                : 'bg-arena-bg border-arena-border text-gray-600'
              }`}
          >
            {i < strikes ? '✕' : '○'}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
