"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getCurrentUser, subscribeAuth, addVehicle, selectVehicle, getSelectedVehicle, logout, removeVehicle } from "@/lib/auth"

export default function ChooseVehiclePage() {
  const [user, setUser] = useState(() => getCurrentUser())
  const [newName, setNewName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const unsub = subscribeAuth((u) => setUser(u))
    return unsub
  }, [])

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>You must be logged in to choose a vehicle. <a href="/login" className="text-primary">Login</a></div>
      </div>
    )
  }

  async function handleSelect(id: string) {
    console.log('choose-vehicle: selecting', id)
    try {
      await selectVehicle(id)
    } catch (e) {
      console.error('selectVehicle failed', e)
    }
    // navigate after selection
    router.push('/dashboard')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setError(null)
    try {
      const v = await addVehicle(newName.trim())
      console.log('choose-vehicle: adding & selecting', v)
      setNewName("")
      // already selected by addVehicle in API, but ensure client selects too
      await selectVehicle(v.id)
      router.push('/dashboard')
    } catch (err: any) {
      console.error('addVehicle failed', err)
      setError(err?.message ?? 'Failed to add vehicle')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-xl p-6 bg-card rounded">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Choose Vehicle</h2>
          <div>
            <button className="px-3 py-1 border rounded mr-2" onClick={() => { logout(); router.push('/') }}>Sign out</button>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          {user.vehicles.length === 0 && <div className="text-sm text-muted-foreground">No vehicles yet. Add one below.</div>}
          {user.vehicles.map((v) => (
            <div key={v.id} className="p-3 rounded bg-muted/50 flex items-center justify-between">
              <div>
                <div className="font-medium">{v.name ?? v.id}</div>
                <div className="text-xs text-muted-foreground">ID: {v.id}</div>
              </div>
              <div>
                <button className="px-3 py-1 bg-primary text-white rounded mr-2" onClick={() => handleSelect(v.id)}>Use</button>
                <button className="px-3 py-1 border rounded text-sm" onClick={async () => {
                  if (!confirm(`Delete vehicle ${v.name ?? v.id}? This cannot be undone.`)) return
                  try {
                    await removeVehicle(v.id)
                    // if deleted vehicle was selected, navigate back to chooser (stay on page) or clear selection
                    // refresh local user state handled by subscribeAuth
                  } catch (err: any) {
                    console.error('removeVehicle failed', err)
                    setError(err?.message ?? 'Failed to remove vehicle')
                  }
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd} className="mt-3">
          {error && <div className="mb-2 text-sm text-destructive">{error}</div>}
          <label className="block mb-2 text-sm">Add new vehicle</label>
          <div className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 px-3 py-2 border rounded" placeholder="Vehicle name" />
            <button type="submit" className="px-4 py-2 bg-primary text-white rounded">Add & Use</button>
          </div>
        </form>
      </div>
    </div>
  )
}
