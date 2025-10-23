export type Device = {
  id: string
  name?: string
}

export type AuthUser = {
  id: string
  email: string
  name?: string
  devices: Device[]
  selectedDevice?: string | null
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
const deviceSubscribers: Array<(vId: string | null) => void> = []

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

function notifyDevice() {
  const vId = currentUser?.selectedDevice ?? null
  deviceSubscribers.forEach((cb) => cb(vId))
}

function loadFromStorage() {
  try {
    if (typeof window === 'undefined') return
    token = localStorage.getItem(TOKEN_KEY)
  } catch (e) {}
}

loadFromStorage()

export async function signup(email: string, password: string, initialDevice?: { name?: string }) {
  const body: any = { email, password }
  if (initialDevice?.name) body.deviceName = initialDevice.name
  const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) })
  token = res.token
  currentUser = res.user
  if (token !== null) {
    try { localStorage.setItem(TOKEN_KEY, token) } catch (e) {}
  }
  notify()
  notifyDevice()
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
  notifyDevice()
  return { token, user: currentUser }
}

export function logout() {
  token = null
  currentUser = null
  try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
  notify()
  notifyDevice()
}

export async function fetchMe() {
  if (!token) return null
  const res = await api('/api/me')
  currentUser = res.user
  notify()
  notifyDevice()
  return currentUser
}

export function getToken() { return token }

export function getCurrentUser(): AuthUser | null { return currentUser }

export async function listDevices() {
  const res = await api('/api/devices')
  if (currentUser) currentUser.devices = res.devices
  if (currentUser) currentUser.selectedDevice = res.selectedDevice
  notify()
  notifyDevice()
  return res
}

export async function addDevice(deviceId: string) {
  const res = await api('/api/devices', { method: 'POST', body: JSON.stringify({ deviceId }) })
  if (currentUser) {
    currentUser.devices.push(res.device)
    currentUser.selectedDevice = res.device.id
  }
  notify()
  notifyDevice()
  return res.device
}

export async function removeDevice(deviceId: string) {
  const res = await api(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
  if (currentUser) {
    currentUser.devices = currentUser.devices.filter((v) => v.id !== deviceId)
    // If the removed vehicle was selected, clear selection locally and attempt to persist
    if (currentUser.selectedDevice === deviceId) {
      currentUser.selectedDevice = null
      try {
        // attempt to persist the cleared selection on the server; some backends accept null
        await api('/api/select-device', { method: 'POST', body: JSON.stringify({ deviceId: null }) })
      } catch (e) {
        // ignore persistence errors but keep client state consistent
      }
    }
  }
  notify()
  notifyDevice()
  return res
}

export async function selectDevice(deviceId: string) {
  const res = await api('/api/select-device', { method: 'POST', body: JSON.stringify({ deviceId }) })
  if (currentUser) currentUser.selectedDevice = res.selectedDevice
  notify()
  notifyDevice()
  return res
}

export function getSelectedDevice(): Device | null {
  const cur = currentUser
  if (!cur || !cur.selectedDevice) return null
  const sel = cur.selectedDevice
  return cur.devices.find((v) => v.id === sel) ?? null
}

export function subscribeAuth(cb: (u: AuthUser | null) => void) {
  subscribers.push(cb)
  cb(currentUser)
  return () => { const idx = subscribers.indexOf(cb); if (idx !== -1) subscribers.splice(idx, 1) }
}

export function subscribeSelectedDevice(cb: (vId: string | null) => void) {
  deviceSubscribers.push(cb)
  cb(currentUser?.selectedDevice ?? null)
  return () => { const idx = deviceSubscribers.indexOf(cb); if (idx !== -1) deviceSubscribers.splice(idx, 1) }
}

// If a token exists, try to hydrate user on load (async)
if (token) {
  fetchMe().catch(() => {
    token = null
    try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
  })
}

export function listUsersForDebug() { return { token, currentUser } }
