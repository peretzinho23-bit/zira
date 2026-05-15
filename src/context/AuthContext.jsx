import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, signInAnonymously, updateProfile } from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined) // undefined = still loading
  const signingInRef          = useRef(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser)
      } else if (!signingInRef.current) {
        // No user at all — auto sign-in anonymously
        signingInRef.current = true
        try {
          const cred = await signInAnonymously(auth)
          // Assign a random Hebrew display name so the DB always has a name
          const name = `שחקן ${100 + Math.floor(Math.random() * 900)}`
          await updateProfile(cred.user, { displayName: name })
          // onAuthStateChanged will fire again with the new anonymous user
        } catch (err) {
          console.error('Anonymous sign-in failed:', err)
          setUser(null)
        }
      }
    })
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading: user === undefined }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
