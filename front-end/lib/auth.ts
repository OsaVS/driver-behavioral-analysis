export type Vehicle = {
  id: string
  name?: string
}

export type AuthUser = {
  id: string
  email: string
  name?: string
  vehicles: Vehicle[]
  selectedVehicle?: string | null
}

export type AuthResponse = {
  token: string
  user: AuthUser
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'
const TOKEN_KEY = 'app_token'

let currentUser: AuthUser | null = null
let token: string | null = null
const subscribers: Array<(u: AuthUser | null) => void> = []
const vehicleSubscribers: Array<(vId: string | null) => void> = []

async function api(path: string, opts: any = {}) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { headers, ...opts })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    // prefer common "message" field, fall back to "error"
    const msg = json?.message || json?.error || 'API error'
    throw new Error(msg)
  }
  return json
}

function notify() {
  subscribers.forEach((cb) => cb(currentUser))
}

function notifyVehicle() {
  const vId = currentUser?.selectedVehicle ?? null
  vehicleSubscribers.forEach((cb) => cb(vId))
}

function loadFromStorage() {
  try {
    if (typeof window === 'undefined') return
    token = localStorage.getItem(TOKEN_KEY)
  } catch (e) {}
}

loadFromStorage()

export async function signup(email: string, password: string, name?: string, initialVehicle?: { name?: string }) {
  const body: any = { email, password, name }
  if (initialVehicle?.name) body.vehicleName = initialVehicle.name
  const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) })
  token = res.token
  currentUser = res.user
  if (token !== null) {
    try { localStorage.setItem(TOKEN_KEY, token) } catch (e) {}
  }
  notify()
  notifyVehicle()
  return { token, user: currentUser }
}

export async function login(email: string, password: string) {
  const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  token = res.token
  currentUser = res.user
  if (token !== null) {
    try { localStorage.setItem(TOKEN_KEY, token) } catch (e) {}
  }
  notify()
  notifyVehicle()
  return { token, user: currentUser }
}

export function logout() {
  token = null
  currentUser = null
  try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
  notify()
  notifyVehicle()
}

export async function fetchMe() {
  if (!token) return null
  const res = await api('/api/me')
  currentUser = res.user
  notify()
  notifyVehicle()
  return currentUser
}

export function getToken() { return token }

export function getCurrentUser(): AuthUser | null { return currentUser }

export async function listVehicles() {
  const res = await api('/api/vehicles')
  if (currentUser) currentUser.vehicles = res.vehicles
  if (currentUser) currentUser.selectedVehicle = res.selectedVehicle
  notify()
  notifyVehicle()
  return res
}

export async function addVehicle(vehicleId: string) {
  const res = await api('/api/vehicles', { method: 'POST', body: JSON.stringify({ vehicleId }) })
  if (currentUser) {
    currentUser.vehicles.push(res.vehicle)
    currentUser.selectedVehicle = res.vehicle.id
  }
  notify()
  notifyVehicle()
  return res.vehicle
}

export async function removeVehicle(vehicleId: string) {
  const res = await api(`/api/vehicles/${encodeURIComponent(vehicleId)}`, { method: 'DELETE' })
  if (currentUser) {
    currentUser.vehicles = currentUser.vehicles.filter((v) => v.id !== vehicleId)
    // If the removed vehicle was selected, clear selection locally and attempt to persist
    if (currentUser.selectedVehicle === vehicleId) {
      currentUser.selectedVehicle = null
      try {
        // attempt to persist the cleared selection on the server; some backends accept null
        await api('/api/select-vehicle', { method: 'POST', body: JSON.stringify({ vehicleId: null }) })
      } catch (e) {
        // ignore persistence errors but keep client state consistent
      }
    }
  }
  notify()
  notifyVehicle()
  return res
}

export async function selectVehicle(vehicleId: string) {
  const res = await api('/api/select-vehicle', { method: 'POST', body: JSON.stringify({ vehicleId }) })
  if (currentUser) currentUser.selectedVehicle = res.selectedVehicle
  notify()
  notifyVehicle()
  return res
}

export function getSelectedVehicle(): Vehicle | null {
  const cur = currentUser
  if (!cur || !cur.selectedVehicle) return null
  const sel = cur.selectedVehicle
  return cur.vehicles.find((v) => v.id === sel) ?? null
}

export function subscribeAuth(cb: (u: AuthUser | null) => void) {
  subscribers.push(cb)
  cb(currentUser)
  return () => { const idx = subscribers.indexOf(cb); if (idx !== -1) subscribers.splice(idx, 1) }
}

export function subscribeSelectedVehicle(cb: (vId: string | null) => void) {
  vehicleSubscribers.push(cb)
  cb(currentUser?.selectedVehicle ?? null)
  return () => { const idx = vehicleSubscribers.indexOf(cb); if (idx !== -1) vehicleSubscribers.splice(idx, 1) }
}

// If a token exists, try to hydrate user on load (async)
if (token) {
  fetchMe().catch(() => {
    token = null
    try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
  })
}

export function listUsersForDebug() { return { token, currentUser } }
