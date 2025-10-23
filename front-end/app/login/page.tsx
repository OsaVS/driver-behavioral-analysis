"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { login } from "@/lib/auth"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await login(email, password)
      router.push('/choose-device')
    } catch (err: any) {
      setError(err?.message ?? 'Login failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-md p-6 bg-card rounded">
        <h2 className="text-xl font-semibold mb-4">Log in</h2>
        {error && <div className="text-sm text-destructive mb-2">{error}</div>}
        <label className="block mb-2">
          <div className="text-sm mb-1">Email</div>
          <input className="w-full px-3 py-2 border rounded" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block mb-4">
          <div className="text-sm mb-1">Password</div>
          <input type="password" className="w-full px-3 py-2 border rounded" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-primary text-white rounded" type="submit">Sign in</button>
          <a className="px-4 py-2 border rounded" href="/signup">Create account</a>
        </div>
      </form>
    </div>
  )
}
