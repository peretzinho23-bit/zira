import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './components/Auth/Login'
import Lobby from './components/Lobby'
import GameRoom from './components/GameRoom'

function Spinner() {
  return (
    <div className="min-h-screen bg-arena-bg flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-arena-neon border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={<ProtectedRoute><Lobby /></ProtectedRoute>}
        />
        <Route
          path="/game/:gameId"
          element={<ProtectedRoute><GameRoom /></ProtectedRoute>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <div dir="rtl" className="min-h-screen bg-arena-bg text-white font-hebrew">
        <AppRoutes />
      </div>
    </AuthProvider>
  )
}
