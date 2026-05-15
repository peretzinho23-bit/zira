import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined)  // undefined = loading
  const signingInRef    = useRef(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async firebaseUser => {
      if (firebaseUser) {
        setUser(firebaseUser)
      } else if (!signingInRef.current) {
        signingInRef.current = true
        try {
          // Auto sign-in anonymously — displayName will be set by nickname screen
          await signInAnonymously(auth)
          // onAuthStateChanged fires again with the new anonymous user
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
