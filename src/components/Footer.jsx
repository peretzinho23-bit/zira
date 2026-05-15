import React from 'react'
import { motion } from 'framer-motion'

export default function ArenaFooter() {
  return (
    <footer className="text-center py-5 border-t border-arena-border/40">
      <motion.p
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        className="text-xs tracking-[0.2em] uppercase select-none"
      >
        <span className="text-gray-600">Developed by </span>
        <span className="text-arena-neon font-black neon-text">Peretzinho</span>
        <span className="text-arena-border mx-2">·</span>
        <span className="text-gray-700">© 2025</span>
      </motion.p>
    </footer>
  )
}
