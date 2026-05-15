import {
  ref,
  set,
  get,
  push,
  update,
  onValue,
  remove,
  runTransaction,
} from 'firebase/database'
import { rtdb } from '../firebase'

// ---------- helpers ----------

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O to avoid confusion

function generateCode() {
  let code = ''
  for (let i = 0; i < 7; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)]
  return code
}

function buildPlayer(displayName, photoURL) {
  return { displayName, photoURL: photoURL || null, strikes: 0, ready: true }
}

// ---------- random matchmaking ----------

export async function findOrCreateRandomGame(uid, displayName, photoURL) {
  // Scan public queue for a waiting game we can join
  const qSnap = await get(ref(rtdb, 'publicQueue'))
  if (qSnap.exists()) {
    for (const gameId of Object.keys(qSnap.val())) {
      const gSnap = await get(ref(rtdb, `games/${gameId}`))
      const game  = gSnap.val()
      if (
        game &&
        game.status === 'waiting' &&
        !game.players[uid] &&
        Object.keys(game.players).length < 2
      ) {
        // Join this game
        await update(ref(rtdb, `games/${gameId}/players/${uid}`), buildPlayer(displayName, photoURL))
        await remove(ref(rtdb, `publicQueue/${gameId}`))
        return gameId
      }
    }
  }

  // No suitable game — create a new one
  const newRef = push(ref(rtdb, 'games'))
  const gameId = newRef.key

  await set(newRef, {
    status:               'waiting',
    isPrivate:            false,
    code:                 null,
    hostUid:              uid,
    currentTurn:          uid,
    currentQuestionIndex: 0,
    players:              { [uid]: buildPlayer(displayName, photoURL) },
    questions:            null,
    winner:               null,
    createdAt:            Date.now(),
  })

  await set(ref(rtdb, `publicQueue/${gameId}`), true)
  return gameId
}

// ---------- private game ----------

export async function createPrivateGame(uid, displayName, photoURL) {
  const code   = generateCode()
  const newRef = push(ref(rtdb, 'games'))
  const gameId = newRef.key

  await set(newRef, {
    status:               'waiting',
    isPrivate:            true,
    code,
    hostUid:              uid,
    currentTurn:          uid,
    currentQuestionIndex: 0,
    players:              { [uid]: buildPlayer(displayName, photoURL) },
    questions:            null,
    winner:               null,
    createdAt:            Date.now(),
  })

  await set(ref(rtdb, `gameCodes/${code}`), gameId)
  return { gameId, code }
}

export async function joinPrivateGame(codeRaw, uid, displayName, photoURL) {
  const code   = codeRaw.trim().toUpperCase()
  const cSnap  = await get(ref(rtdb, `gameCodes/${code}`))

  if (!cSnap.exists()) throw new Error('קוד חדר לא נמצא')

  const gameId = cSnap.val()
  const gSnap  = await get(ref(rtdb, `games/${gameId}`))
  const game   = gSnap.val()

  if (!game)                              throw new Error('החדר לא קיים')
  if (game.status !== 'waiting')          throw new Error('המשחק כבר התחיל')
  if (Object.keys(game.players).length >= 2) throw new Error('החדר מלא')
  if (game.players[uid])                  return gameId // already in

  await update(ref(rtdb, `games/${gameId}/players/${uid}`), buildPlayer(displayName, photoURL))
  return gameId
}

// ---------- game lifecycle ----------

export function listenGame(gameId, callback) {
  return onValue(ref(rtdb, `games/${gameId}`), (snap) => callback(snap.val()))
}

export async function setGameGenerating(gameId) {
  await update(ref(rtdb, `games/${gameId}`), { status: 'generating' })
}

export async function updateGameWithQuestions(gameId, questions) {
  await update(ref(rtdb, `games/${gameId}`), { questions, status: 'active' })
}

export async function cancelGame(gameId, code, uid) {
  const updates = { [`games/${gameId}/players/${uid}`]: null }
  if (code) updates[`gameCodes/${code}`] = null
  updates[`publicQueue/${gameId}`] = null
  await update(ref(rtdb), updates)
}

// ---------- in-game actions ----------

export async function recordStrike(gameId, uid) {
  return runTransaction(
    ref(rtdb, `games/${gameId}/players/${uid}/strikes`),
    (cur) => (cur || 0) + 1
  )
}

export async function advanceTurn(gameId, nextIndex, nextTurnUid) {
  await update(ref(rtdb, `games/${gameId}`), {
    currentQuestionIndex: nextIndex,
    currentTurn:          nextTurnUid,
  })
}

export async function endGame(gameId, winnerUid) {
  await update(ref(rtdb, `games/${gameId}`), {
    winner: winnerUid,
    status: 'finished',
  })
}
