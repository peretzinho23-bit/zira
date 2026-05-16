/**
 * BoardMulti.jsx — לוח כיבוש טריטוריות | מולטיפלייר
 * ══════════════════════════════════════════════════════
 * שני שחקנים אמיתיים מתחרים לכבוש טריטוריות בוטים.
 * ראשון ל-13/25 טריטוריות מנצח.
 *
 * Firebase paths:
 *   boardRooms/{roomId}/  – מצב הלוח המשותף
 *   boardQueue/{uid}/     – תור ממתינים
 *
 * Rules להוסיף בפאנל Firebase:
 *   "boardRooms": { ".read": "auth != null", ".write": "auth != null" }
 *   "boardQueue":  { ".read": "auth != null", ".write": "auth != null" }
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ref, get, push, update, onValue, remove } from 'firebase/database'
import { rtdb } from '../firebase'
import { BoardDuel } from './Board'

// ─────────────────── Shared constants (mirror Board.jsx) ─────────────────────

const GRID     = 5
const WIN_CELLS = 13   // first to 13 out of 25 wins
const TOPICS_24 = [
  'ספורט', 'היסטוריה', 'מדע', 'בידור', 'גיאוגרפיה', 'מוזיקה',
  'קולנוע', 'אמנות', 'ספרות', 'טכנולוגיה', 'מיתולוגיה', 'בישול',
  'ספורט', 'היסטוריה', 'מדע', 'גיאוגרפיה', 'מוזיקה', 'בידור',
  'טכנולוגיה', 'אמנות', 'ספרות', 'קולנוע', 'מדע', 'ספורט',
]
const DIFFS_24 = [
  'קל', 'בינוני', 'קל', 'בינוני', 'קשה', 'בינוני',
  'קל', 'קשה', 'בינוני', 'קל', 'בינוני', 'קשה',
  'בינוני', 'קל', 'קשה', 'בינוני', 'קל', 'בינוני',
  'קשה', 'בינוני', 'קל', 'בינוני', 'קשה', 'בינוני',
]
const PALETTE = [
  { bg: '#065f46', border: '#34d399', glow: 'rgba(52,211,153,0.65)'  },  // 0 emerald — P1
  { bg: '#581c87', border: '#c084fc', glow: 'rgba(192,132,252,0.65)' },  // 1 purple
  { bg: '#1e3a8a', border: '#60a5fa', glow: 'rgba(96,165,250,0.65)'  },  // 2 blue   — P2
  { bg: '#7c2d12', border: '#fb923c', glow: 'rgba(251,146,60,0.65)'  },
  { bg: '#7f1d1d', border: '#f87171', glow: 'rgba(248,113,113,0.65)' },
  { bg: '#134e4a', border: '#2dd4bf', glow: 'rgba(45,212,191,0.65)'  },
  { bg: '#312e81', border: '#818cf8', glow: 'rgba(129,140,248,0.65)' },
  { bg: '#831843', border: '#f472b6', glow: 'rgba(244,114,182,0.65)' },
  { bg: '#713f12', border: '#fbbf24', glow: 'rgba(251,191,36,0.65)'  },
  { bg: '#164e63', border: '#22d3ee', glow: 'rgba(34,211,238,0.65)'  },
  { bg: '#881337', border: '#fb7185', glow: 'rgba(251,113,133,0.65)' },
  { bg: '#365314', border: '#a3e635', glow: 'rgba(163,230,53,0.65)'  },
]

function getAdjacentIds(id) {
  const row = Math.floor(id / GRID)
  const col  = id % GRID
  const adj  = []
  if (row > 0)        adj.push(id - GRID)
  if (row < GRID - 1) adj.push(id + GRID)
  if (col > 0)        adj.push(id - 1)
  if (col < GRID - 1) adj.push(id + 1)
  return adj
}

// ─────────────────────────── Firebase helpers ─────────────────────────────────

function mkQueueEntry(user) {
  return {
    displayName:   user.displayName || 'שחקן',
    photoURL:      user.photoURL    || null,
    joinedAt:      Date.now(),
  }
}

function mkRoomPlayer(user, colorKey) {
  return {
    displayName: user.displayName || 'שחקן',
    photoURL:    user.photoURL    || null,
    colorKey,
  }
}

// Returns roomId. Finds or creates a board room.
export async function findOrCreateBoardRoom(user) {
  // 1. Check boardQueue for a waiting player
  const qSnap = await get(ref(rtdb, 'boardQueue'))
  if (qSnap.exists()) {
    const entries = Object.entries(qSnap.val())
    const waiting  = entries.find(([uid, d]) => uid !== user.uid && d.pendingRoomId)
    if (waiting) {
      const [hostUid, hostData] = waiting
      const roomId = hostData.pendingRoomId
      // Verify room still waiting
      const rSnap = await get(ref(rtdb, `boardRooms/${roomId}`))
      const room  = rSnap.val()
      if (room?.status === 'waiting' && !room.players?.[user.uid]) {
        await update(ref(rtdb), {
          [`boardRooms/${roomId}/players/${user.uid}`]: mkRoomPlayer(user, 2),
          [`boardQueue/${hostUid}`]:                    null,
        })
        return roomId
      }
    }
  }

  // 2. No waiting room — create one and wait
  const roomId = push(ref(rtdb, 'boardRooms')).key
  await update(ref(rtdb), {
    [`boardRooms/${roomId}`]: {
      status:    'waiting',
      hostUid:   user.uid,
      turn:      null,
      winner:    null,
      createdAt: Date.now(),
      cells:     null,
      players:   { [user.uid]: mkRoomPlayer(user, 0) },
    },
    [`boardQueue/${user.uid}`]: {
      ...mkQueueEntry(user),
      pendingRoomId: roomId,
    },
  })
  return roomId
}

// Host calls this when 2nd player joins — initializes the board in Firebase
async function initMultiBoard(roomId, playerMap) {
  const [p1Uid, p2Uid] = Object.keys(playerMap)
  const p1Name = playerMap[p1Uid]?.displayName ?? 'שחקן 1'
  const p2Name = playerMap[p2Uid]?.displayName ?? 'שחקן 2'

  const cells = {}
  for (let id = 0; id < GRID * GRID; id++) {
    if (id === 0) {
      cells[id] = { id, owner: p1Uid, ownerName: p1Name, topic: 'מגוון', difficulty: null, colorKey: 0 }
    } else if (id === 24) {
      cells[id] = { id, owner: p2Uid, ownerName: p2Name, topic: 'מגוון', difficulty: null, colorKey: 2 }
    } else {
      const bi = id - 1
      cells[id] = {
        id,
        owner:      `bot-${id}`,
        ownerName:  `שחקן ${id}`,
        topic:      TOPICS_24[bi % TOPICS_24.length],
        difficulty: DIFFS_24[bi  % DIFFS_24.length],
        colorKey:   (id % 11) + 1,
      }
    }
  }

  // Ziri — random first turn
  const firstTurn = [p1Uid, p2Uid][Math.floor(Math.random() * 2)]

  await update(ref(rtdb, `boardRooms/${roomId}`), {
    cells,
    turn:   firstTurn,
    status: 'playing',
  })
}

// ──────────────────── Small UI components ────────────────────────────────────

function WaitingDots({ label }) {
  const [d, setD] = useState('.')
  useEffect(() => {
    const t = setInterval(() => setD(x => x.length >= 3 ? '.' : x + '.'), 500)
    return () => clearInterval(t)
  }, [])
  return <span>{label}{d}</span>
}

function PlayerAvatar({ photoURL, name, colorKey = 0, size = 'md' }) {
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm'
  const pal = PALETTE[colorKey] ?? PALETTE[0]
  if (photoURL) return (
    <img src={photoURL} alt={name} referrerPolicy="no-referrer"
      className={`${sz} rounded-full object-cover border-2 flex-shrink-0`}
      style={{ borderColor: pal.border }} />
  )
  return (
    <div className={`${sz} rounded-full border-2 flex items-center justify-center font-black flex-shrink-0`}
      style={{ backgroundColor: pal.bg, borderColor: pal.border, color: pal.border }}>
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

// ═══════════════════════════ MAIN COMPONENT ═══════════════════════════════════

export default function BoardMulti({ user, onExit }) {
  const [roomId,    setRoomId]    = useState(null)
  const [room,      setRoom]      = useState(null)
  const [view,      setView]      = useState('matching')  // matching|board|duel|finished
  const [attacking, setAttacking] = useState(null)        // { cellId, topic, difficulty }
  const [matchErr,  setMatchErr]  = useState('')
  const boardInitRef = useRef(false)

  // ── Matchmaking on mount ──
  useEffect(() => {
    findOrCreateBoardRoom(user)
      .then(id => setRoomId(id))
      .catch(err => setMatchErr(err.message || 'שגיאה בחיבור'))
  }, []) // eslint-disable-line

  // ── Listen to room ──
  useEffect(() => {
    if (!roomId) return
    const unsub = onValue(ref(rtdb, `boardRooms/${roomId}`), snap => {
      if (!snap.exists()) { onExit(); return }
      const data = snap.val()
      setRoom(data)
      if (data.status === 'playing' && view === 'matching') setView('board')
      if (data.status === 'finished' && view !== 'finished') setView('finished')
    })
    // Cleanup queue entry on unmount
    return () => {
      unsub()
      remove(ref(rtdb, `boardQueue/${user.uid}`)).catch(() => {})
    }
  }, [roomId]) // eslint-disable-line

  // ── Host: initialize board when 2nd player joins ──
  useEffect(() => {
    if (!room || !roomId) return
    if (room.hostUid !== user.uid) return
    if (room.status !== 'waiting') return
    if (Object.keys(room.players ?? {}).length < 2) return
    if (boardInitRef.current) return
    boardInitRef.current = true
    initMultiBoard(roomId, room.players).catch(console.error)
  }, [room, roomId, user.uid])

  // ── Derived data ──
  const cells = room?.cells ? Object.values(room.cells) : []

  const myColorKey = room?.players?.[user.uid]?.colorKey ?? 0
  const myPal      = PALETTE[myColorKey]

  const myCellIds = useMemo(
    () => cells.filter(c => c.owner === user.uid).map(c => c.id),
    [cells, user.uid]
  )
  const attackableCellIds = useMemo(() => {
    const s = new Set()
    myCellIds.forEach(pid => {
      getAdjacentIds(pid).forEach(adj => {
        if (cells[adj]?.owner !== user.uid) s.add(adj)
      })
    })
    return s
  }, [myCellIds, cells, user.uid])

  const isMyTurn = room?.turn === user.uid

  // ── Handle cell click ──
  function handleCellClick(id) {
    if (!isMyTurn || view !== 'board') return
    if (!attackableCellIds.has(id)) return
    const cell = cells[id]
    setAttacking({ cellId: id, topic: cell.topic, difficulty: cell.difficulty || 'בינוני' })
    setView('duel')
  }

  // ── After duel ──
  async function handleDuelComplete(won) {
    setView('board')
    const targetCell = attacking
    setAttacking(null)
    if (!room || !roomId || !targetCell) return

    const updates   = {}
    const otherUid  = Object.keys(room.players).find(u => u !== user.uid)

    if (won) {
      const me = room.players[user.uid]
      updates[`boardRooms/${roomId}/cells/${targetCell.cellId}`] = {
        ...cells[targetCell.cellId],
        owner:     user.uid,
        ownerName: me?.displayName ?? user.displayName ?? 'שחקן',
        colorKey:  myColorKey,
      }
    }

    // Check win condition (count after potential capture)
    const myFinalCount = cells.filter(c => c.owner === user.uid).length + (won ? 1 : 0)
    if (myFinalCount >= WIN_CELLS) {
      updates[`boardRooms/${roomId}/winner`] = user.uid
      updates[`boardRooms/${roomId}/status`] = 'finished'
    } else {
      updates[`boardRooms/${roomId}/turn`] = otherUid
    }

    await update(ref(rtdb), updates).catch(console.error)
  }

  // ── Cancel matchmaking ──
  async function handleCancel() {
    if (roomId) {
      await remove(ref(rtdb, `boardRooms/${roomId}`)).catch(() => {})
      await remove(ref(rtdb, `boardQueue/${user.uid}`)).catch(() => {})
    }
    onExit()
  }

  // ════════════════════════ RENDER ═════════════════════════════════════════════

  // ── Error ──
  if (matchErr) return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-red-400 font-bold">שגיאה בחיבור</p>
      <p className="text-gray-600 text-sm">{matchErr}</p>
      <button onClick={onExit} className="text-[#a855f7] underline text-sm">חזרה ללובי</button>
    </div>
  )

  // ── Matching ──
  if (view === 'matching' || !room || room.status === 'waiting') {
    const waitingCount = Object.keys(room?.players ?? {}).length
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 text-center gap-6" dir="rtl">
        <div className="relative">
          <motion.div animate={{ scale: [1, 1.22, 1], opacity: [0.15, 0.5, 0.15] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full" style={{ background: 'rgba(168,85,247,0.15)' }} />
          <div className="relative w-28 h-28 rounded-full border-4 flex items-center justify-center text-4xl"
            style={{ borderColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.4)' }}>
            🗺️
          </div>
        </div>

        <h2 className="text-2xl font-black text-white">
          <WaitingDots label="מחפש יריב" />
        </h2>
        <p className="text-gray-500 text-sm">
          {waitingCount}/2 שחקנים מוכנים
        </p>

        {/* Show waiting players */}
        <div className="flex gap-4">
          {Object.entries(room?.players ?? {}).map(([uid, data]) => (
            <motion.div key={uid} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-2">
              <PlayerAvatar photoURL={data.photoURL} name={data.displayName} colorKey={data.colorKey} />
              <span className="text-xs text-gray-400">{data.displayName}</span>
              <span className="text-[10px] text-green-400">מחובר ✓</span>
            </motion.div>
          ))}
          {waitingCount < 2 && (
            <div className="flex flex-col items-center gap-2 opacity-30">
              <div className="w-11 h-11 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center text-gray-600 text-sm">?</div>
              <span className="text-xs text-gray-600">ממתין...</span>
            </div>
          )}
        </div>

        <button onClick={handleCancel}
          className="text-gray-700 hover:text-red-400 text-sm underline transition-colors">
          ביטול וחזרה ללובי
        </button>
      </div>
    )
  }

  // ── Finished ──
  if (view === 'finished' || room.status === 'finished') {
    const iWon       = room.winner === user.uid
    const winnerData = room.players?.[room.winner]
    const SPARKS     = ['🏆', '✨', '⭐', '🌟', '💫', '🎉']
    const myCount    = cells.filter(c => c.owner === user.uid).length
    const oppUid     = Object.keys(room.players ?? {}).find(u => u !== user.uid)
    const oppCount   = cells.filter(c => c.owner === oppUid).length

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 text-center relative overflow-hidden" dir="rtl">

        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.06, 0.18, 0.06] }}
          transition={{ duration: 2.5, repeat: Infinity }}
          className="absolute w-96 h-96 rounded-full blur-3xl pointer-events-none"
          style={{ background: iWon ? '#f59e0b' : '#7f1d1d' }} />

        {iWon && SPARKS.map((e, i) => (
          <motion.span key={i}
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: -160, opacity: [0, 1, 1, 0], x: (i % 2 ? 1 : -1) * (8 + i * 10) }}
            transition={{ delay: i * 0.15, duration: 2.1, repeat: Infinity, repeatDelay: 0.7 }}
            className="absolute text-2xl pointer-events-none select-none" style={{ left: `${10 + i * 14}%` }}>
            {e}
          </motion.span>
        ))}

        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 13 }}
          className="text-8xl mb-3 relative z-10 select-none">
          {iWon ? '👑' : '💀'}
        </motion.div>

        <h1 className="text-5xl font-black mb-1 relative z-10"
          style={{
            color: iWon ? '#f59e0b' : '#f87171',
            textShadow: iWon ? '0 0 20px rgba(245,158,11,0.5)' : undefined,
          }}>
          {iWon ? 'כבשת את הזירה!' : 'הפסדת בקרב!'}
        </h1>

        <p className="text-gray-400 text-sm mb-6 relative z-10">
          {iWon
            ? `כל הכבוד ${winnerData?.displayName ?? ''}! 👑`
            : `${winnerData?.displayName ?? 'היריב'} ניצח בקרב הטריטוריות`}
        </p>

        {/* Score board */}
        <div className="flex gap-6 mb-8 relative z-10">
          {Object.entries(room.players ?? {}).map(([uid, data]) => {
            const count = cells.filter(c => c.owner === uid).length
            const isWin = uid === room.winner
            return (
              <div key={uid}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border"
                style={{ borderColor: isWin ? '#f59e0b55' : '#1e1e2e', background: isWin ? 'rgba(245,158,11,0.05)' : 'rgba(18,18,26,0.6)' }}>
                <PlayerAvatar photoURL={data.photoURL} name={data.displayName} colorKey={data.colorKey} />
                <span className="text-xs font-semibold" style={{ color: isWin ? '#f59e0b' : '#9ca3af' }}>
                  {data.displayName}
                </span>
                <span className="text-xl font-black" style={{ color: isWin ? '#f59e0b' : '#6b7280' }}>
                  {count}
                </span>
                <span className="text-[10px] text-gray-600">טריטוריות</span>
                {isWin && <span className="text-xs" style={{ color: '#f59e0b' }}>🥇 מנצח</span>}
              </div>
            )
          })}
        </div>

        <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.93 }}
          onClick={onExit}
          className="relative z-10 px-10 py-3 rounded-xl font-black text-lg"
          style={{
            background: iWon ? '#f59e0b' : '#a855f7',
            color: iWon ? '#000' : '#fff',
            boxShadow: iWon ? '0 0 20px rgba(245,158,11,0.4)' : '0 0 20px rgba(168,85,247,0.4)',
          }}>
          חזרה ללובי
        </motion.button>
      </motion.div>
    )
  }

  // ── Duel overlay ──
  if (view === 'duel' && attacking) {
    return (
      <div className="min-h-screen bg-[#0a0a0f]/96 flex flex-col overflow-y-auto" dir="rtl"
        style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
        <div className="flex-1 flex flex-col justify-center px-4 py-6 max-w-lg mx-auto w-full">
          <BoardDuel
            topic={attacking.topic}
            difficulty={attacking.difficulty}
            user={user}
            onComplete={handleDuelComplete}
          />
        </div>
      </div>
    )
  }

  // ── Board ──
  const isPlaying = room.status === 'playing'
  const litCellIds = new Set([...myCellIds, ...attackableCellIds])

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col" dir="rtl">

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#1e1e2e' }}>
        <button onClick={handleCancel} className="text-gray-600 hover:text-red-400 text-xs transition-colors">↩ עזוב</button>
        <h1 className="text-lg font-black" style={{ color: '#a855f7', textShadow: '0 0 10px rgba(168,85,247,0.5)' }}>
          🗺️ כיבוש הזירה
        </h1>
        <span className="text-gray-600 text-xs">{myCellIds.length}/{GRID * GRID}</span>
      </header>

      {/* Players bar */}
      <div className="px-4 py-2 flex items-center justify-between border-b" style={{ borderColor: '#1e1e2e', background: '#12121a' }}>
        {Object.entries(room.players ?? {}).map(([uid, data]) => {
          const count   = cells.filter(c => c.owner === uid).length
          const isMe    = uid === user.uid
          const isActive = room.turn === uid
          const pal     = PALETTE[data.colorKey ?? 0]
          return (
            <div key={uid}
              className={`flex items-center gap-2 transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-45'}`}>
              <div className="relative">
                <PlayerAvatar photoURL={data.photoURL} name={data.displayName} colorKey={data.colorKey} size="sm" />
                {isActive && (
                  <motion.span animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 0.85, repeat: Infinity }}
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                    style={{ background: pal.border, borderColor: '#0a0a0f' }} />
                )}
              </div>
              <div>
                <p className="text-xs font-bold leading-tight" style={{ color: isMe ? pal.border : '#d1d5db' }}>
                  {data.displayName}{isMe && ' (אתה)'}
                </p>
                <p className="text-[10px] text-gray-600">{count} טריטוריות</p>
              </div>
            </div>
          )
        })}

        <div className="text-center">
          {isMyTurn ? (
            <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.3, repeat: Infinity }}
              className="text-xs font-bold" style={{ color: '#a855f7' }}>✨ התור שלך</motion.span>
          ) : (
            <span className="text-[10px] text-gray-600">ממתין ליריב...</span>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="text-center py-1.5">
        <p className="text-[10px] text-gray-700">
          {isMyTurn && attackableCellIds.size > 0
            ? `${attackableCellIds.size} משבצות ניתנות לתקיפה — לחץ על משבצת מוארת`
            : isMyTurn
            ? 'אין שכנות תקיפות'
            : `תור של ${room.players?.[room.turn]?.displayName ?? 'היריב'}...`}
        </p>
      </div>

      {/* Grid */}
      <main className="flex-1 flex items-center justify-center p-3 sm:p-4">
        <div
          className="grid gap-1.5 sm:gap-2 w-full"
          style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`, maxWidth: 420 }}
        >
          {cells.map(cell => {
            if (!cell) return null
            const isLit        = litCellIds.has(cell.id)
            const isAttackable = attackableCellIds.has(cell.id) && isMyTurn
            const pal          = PALETTE[cell.colorKey] ?? PALETTE[1]
            const isMyCell     = cell.owner === user.uid
            const isOpponent   = !isMyCell && !cell.owner?.startsWith('bot-')

            return (
              <motion.div
                key={cell.id}
                onClick={() => handleCellClick(cell.id)}
                whileHover={isAttackable ? { scale: 1.06, zIndex: 10 } : {}}
                whileTap={isAttackable ? { scale: 0.96 } : {}}
                animate={isAttackable ? {
                  boxShadow: [`0 0 0px ${pal.glow}`, `0 0 16px ${pal.glow}`, `0 0 0px ${pal.glow}`],
                } : {}}
                transition={isAttackable ? { boxShadow: { duration: 1.4, repeat: Infinity } } : {}}
                className="relative aspect-square rounded-xl flex flex-col items-center justify-between p-1.5 select-none"
                style={{
                  backgroundColor: pal.bg,
                  border: `2px solid ${isAttackable || isMyCell || isOpponent ? pal.border : 'transparent'}`,
                  opacity: isLit ? 1 : 0.2,
                  cursor: isAttackable ? 'pointer' : 'default',
                  transition: 'opacity 0.3s, border-color 0.3s',
                }}
              >
                <span className="text-white font-bold leading-tight text-center w-full truncate"
                  style={{ fontSize: 'clamp(7px, 1.8vw, 10px)' }}>
                  {cell.ownerName}
                </span>
                <span className="text-white font-black text-center leading-tight w-full"
                  style={{ fontSize: 'clamp(8px, 2vw, 12px)' }}>
                  {cell.topic}
                </span>
                <span className="text-white/55 text-center w-full truncate"
                  style={{ fontSize: 'clamp(6px, 1.4vw, 9px)' }}>
                  {isMyCell ? '⚔️' : isOpponent ? '🛡️' : cell.difficulty ? `בוט ${cell.difficulty}` : ''}
                </span>

                {isAttackable && (
                  <motion.div
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ border: `2px solid ${pal.border}`, boxShadow: `inset 0 0 8px ${pal.glow}` }}
                  />
                )}
              </motion.div>
            )
          })}
        </div>
      </main>

      {/* Legend */}
      <footer className="px-4 py-2 border-t flex items-center justify-center gap-4 flex-shrink-0" style={{ borderColor: '#1e1e2e' }}>
        {Object.entries(room.players ?? {}).map(([uid, data]) => {
          const pal = PALETTE[data.colorKey ?? 0]
          return (
            <span key={uid} className="flex items-center gap-1 text-gray-600 text-[10px]">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: pal.bg, border: `1px solid ${pal.border}` }} />
              {data.displayName}
            </span>
          )
        })}
        <span className="flex items-center gap-1 text-gray-600 text-[10px]">
          <span className="w-3 h-3 rounded-sm opacity-20 flex-shrink-0" style={{ backgroundColor: '#1e1e2e' }} />
          מחוץ לטווח
        </span>
      </footer>
    </div>
  )
}
