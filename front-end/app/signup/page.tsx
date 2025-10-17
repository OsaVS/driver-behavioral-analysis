"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signup } from "@/lib/auth"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [vehicleName, setVehicleName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await signup(email, password, undefined, { name: vehicleName })
      router.push('/choose-vehicle')
    } catch (err: any) {
      setError(err?.message ?? 'Signup failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-md p-6 bg-card rounded">
        <h2 className="text-xl font-semibold mb-4">Create account</h2>
        {error && <div className="text-sm text-destructive mb-2">{error}</div>}
        <label className="block mb-2">
          <div className="text-sm mb-1">Email</div>
          <input className="w-full px-3 py-2 border rounded" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block mb-2">
          <div className="text-sm mb-1">Password</div>
          <input type="password" className="w-full px-3 py-2 border rounded" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="block mb-4">
          <div className="text-sm mb-1">Vehicle name (optional)</div>
          <input className="w-full px-3 py-2 border rounded" value={vehicleName} onChange={(e) => setVehicleName(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-primary text-white rounded" type="submit">Create account</button>
          <a className="px-4 py-2 border rounded" href="/login">Already have an account?</a>
        </div>
      </form>
    </div>
  )
}
