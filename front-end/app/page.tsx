"use client"

import Link from "next/link"
import { getCurrentUser, logout } from "@/lib/auth"
import { useEffect, useState } from "react"

export default function Page() {
  const [user, setUser] = useState(() => getCurrentUser())

  useEffect(() => {
    // dynamic check in case auth state was changed elsewhere
    setUser(getCurrentUser())
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-2xl w-full p-8">
        <h1 className="text-3xl font-bold mb-4">Driver Behavioral Analysis</h1>
        <p className="text-muted-foreground mb-6">Sign in to view your vehicles and real-time telemetry dashboard.</p>

        {!user ? (
          <div className="space-x-3">
            <Link href="/login" className="px-4 py-2 bg-primary text-white rounded">Log in</Link>
            <Link href="/signup" className="px-4 py-2 border rounded">Sign up</Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm">Signed in as <strong>{user.email}</strong></div>
            <div className="flex gap-3">
              <Link href="/choose-vehicle" className="px-4 py-2 bg-primary text-white rounded">Choose Vehicle</Link>
              <Link href="/dashboard" className="px-4 py-2 border rounded">Dashboard</Link>
              <button className="px-3 py-1 border rounded" onClick={() => { logout(); setUser(null) }}>Sign out</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
