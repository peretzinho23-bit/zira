import React from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Arena from './components/Arena'

function Root() {
  const { user, loading } = useAuth()

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-arena-bg flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-arena-neon border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <Arena />
}

export default function App() {
  return (
    <AuthProvider>
      <div dir="rtl" className="min-h-screen bg-arena-bg text-white" style={{ fontFamily: "'Rubik', sans-serif" }}>
        <Root />
      </div>
    </AuthProvider>
  )
}
