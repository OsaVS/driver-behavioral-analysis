"use client"

import React from "react"
import { type Vehicle } from "@/lib/auth"

export default function VehicleChooser({
  vehicles,
  onSelect,
  onAdd,
  onDelete,
}: {
  vehicles: Vehicle[]
  onSelect: (id: string) => void
  onAdd?: (name: string) => void
  onDelete?: (id: string) => void
}) {
  const [name, setName] = React.useState("")

  return (
    <div>
      <div className="space-y-3 mb-4">
        {vehicles.map((v) => (
          <div key={v.id} className="p-3 rounded bg-muted/50 flex items-center justify-between">
            <div>
              <div className="font-medium">{v.name ?? v.id}</div>
              <div className="text-xs text-muted-foreground">ID: {v.id}</div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1 bg-primary text-white rounded" onClick={() => onSelect(v.id)}>Use</button>
              {onDelete ? (
                <button className="px-3 py-1 border rounded text-sm" onClick={() => onDelete(v.id)}>Delete</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {onAdd ? (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName("") } }} className="flex gap-2">
          <input className="flex-1 px-3 py-2 border rounded" value={name} onChange={(e) => setName(e.target.value)} placeholder="New vehicle name" />
          <button className="px-3 py-1 bg-primary text-white rounded" type="submit">Add</button>
        </form>
      ) : null}
    </div>
  )
}
