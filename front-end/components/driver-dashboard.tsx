"use client"

import { io, type Socket } from "socket.io-client"
import { useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Activity, Gauge, TrendingUp, AlertTriangle, CheckCircle2, Clock } from "lucide-react"
import { getCurrentUser, subscribeAuth, subscribeSelectedDevice, type AuthUser, getSelectedDevice, getToken, fetchMe, logout, selectDevice, listDevices } from "@/lib/auth"
import Link from "next/link"

// Simulated real-time data for the current journey
const generateJourneyData = () => {
  const data = []
  for (let i = 0; i <= 60; i++) {
    const behavior = Math.random() > 0.3 ? 1 : 0 // 1 = good, 0 = bad
    data.push({
      time: i,
      behavior: behavior,
      speed: 40 + Math.random() * 40,
    })
  }
  return data
}

const historicalJourneys: Array<{ id: number; date: string; score: number; duration: string; distance: string }> = [
  { id: 1, date: "2025-10-15", score: 92, duration: "45 min", distance: "32 km" },
  { id: 2, date: "2025-10-14", score: 78, duration: "38 min", distance: "28 km" },
  { id: 3, date: "2025-10-13", score: 88, duration: "52 min", distance: "41 km" },
  { id: 4, date: "2025-10-12", score: 95, duration: "30 min", distance: "25 km" },
  { id: 5, date: "2025-10-11", score: 71, duration: "48 min", distance: "35 km" },
  { id: 6, date: "2025-10-10", score: 85, duration: "42 min", distance: "30 km" },
  { id: 7, date: "2025-10-09", score: 90, duration: "55 min", distance: "45 km" },
]

export default function DriverDashboard() {
  const router = useRouter()
  const socketRef = useRef<Socket | null>(null)
  // device id from query param 'device' if present
  let deviceIdDefault = "Vehicle-1234"
  try {
    const sp = typeof window !== "undefined" ? useSearchParams() : null
    const fromQuery = sp?.get("deviceId")
    if (fromQuery) deviceIdDefault = fromQuery
  } catch (e) {
    // use fallback if hook not available during SSR or other envs
  }

  const [deviceId, setDeviceId] = useState<string>(deviceIdDefault)

  // live timestamp for header
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const [journeyData, setJourneyData] = useState<any[]>([])
  // track hydration to avoid SSR/client markup mismatch for dynamic content
  const [mounted, setMounted] = useState(false)
  // Auth state
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser())
  const [currentBehavior, setCurrentBehavior] = useState<"good" | "bad" | null>(null)
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null)
  const [avgSpeed, setAvgSpeed] = useState<number | null>(null)
  const [maxSpeed, setMaxSpeed] = useState<number | null>(null)
  // Engine RPM (simulated)
  const [rpm, setRpm] = useState(2100)
  // socket connection status
  const [isConnected, setIsConnected] = useState(false)
  // telemetry logging
  const [lastTelemetry, setLastTelemetry] = useState<any | null>(null)
  const [telemetryLog, setTelemetryLog] = useState<any[]>([])

  // ...existing code...
useEffect(() => {
  // Only connect when a user is authenticated
  if (!user || !deviceId) {
    // ensure any existing socket is disconnected
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    return
  }

  // create socket if not already
  if (!socketRef.current) {
    const token = getToken()
    const url = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000')
    socketRef.current = io(url, { transports: ["websocket"], auth: { token } })
  }

  const connectHandler = () => setIsConnected(true)
  const disconnectHandler = () => setIsConnected(false)

  // attach connect/disconnect handlers
  socketRef.current.on("connect", () => {
    console.log("socket connected")
    connectHandler()
  })
  socketRef.current.on("disconnect", (reason: any) => {
    console.log("socket disconnected", reason)
    disconnectHandler()
  })

  const handler = (data: any) => {
    // log incoming packet to console (browser console) and keep an in-page log
    console.log("telemetry", data)
    setLastTelemetry(data)
    setTelemetryLog((prev) => [data, ...prev].slice(0, 100))

    // Process telemetry messages as emitted by the backend (room-delivered).
    const speedVal = typeof data.speed === 'number' ? data.speed : Number(data.speed) || 0
    const behaviorVal: "good" | "bad" = data.behavior_status ?? data.behavior ?? null
    const rpmVal = data.engine_rpm ?? data.rpm ?? null
    const timeSec = data.timestamp ? Math.floor(new Date(data.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000)

    setCurrentSpeed(speedVal)
    setCurrentBehavior(behaviorVal)
    setRpm(rpmVal)

    // Append new point and also compute avg/max speed from the kept window
    setJourneyData((prev) => {
      const next = [
        ...prev.slice(-59),
        {
          time: timeSec,
          speed: speedVal,
          behavior: behaviorVal === "good" ? 1 : 0,
        },
      ]

      const speeds = next.map((d) => (typeof d.speed === 'number' ? d.speed : Number(d.speed) || 0))
      const validSpeeds = speeds.filter((s) => !Number.isNaN(s))
      const avg = validSpeeds.length ? Math.round(validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length) : null
      const mx = validSpeeds.length ? Math.round(Math.max(...validSpeeds)) : null

      // update aggregate stats
      setAvgSpeed(avg)
      setMaxSpeed(mx)

      return next
    })
  }

  socketRef.current.on("telemetry", (data) => {
    console.log("received telemetry", data)
    handler(data)
  })

  return () => {
    if (socketRef.current) {
      socketRef.current.off("telemetry", handler)
      socketRef.current.off("connect", connectHandler)
      socketRef.current.off("disconnect", disconnectHandler)
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setIsConnected(false)
  }
}, [user, deviceId])
// ...existing code...

  // No local simulator: current values will come from socket telemetry only.
  // Simulator removed to avoid showing random values as current state.

  // Subscribe to auth changes and selected device from auth
  useEffect(() => {
    setMounted(true)
    const unsubAuth = subscribeAuth((u) => setUser(u))
    // if there is already a selected device in auth store, use it
    try {
      const sv = getSelectedDevice()
      if (sv) setDeviceId(sv.id)
    } catch (e) {}

    const unsubVeh = subscribeSelectedDevice((vId) => {
      console.log('driver-dashboard: selected device changed ->', vId)
      if (vId) setDeviceId(vId)
    })

    return () => {
      unsubAuth()
      unsubVeh()
    }
  }, [])

  // Calculate last 10 seconds behavior
  const last10Seconds = journeyData.slice(-5)
  const goodCount = last10Seconds.filter((d) => d.behavior === 1).length
  const last10Score = Math.round((goodCount / last10Seconds.length) * 100)

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {!mounted ? (
        // render a stable placeholder during SSR and before hydration to avoid mismatch
        <div className="p-6 bg-muted rounded" />
      ) : !user ? (
        <div className="p-6 bg-muted rounded flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Please sign in to view the dashboard.</div>
          <div className="flex gap-2">
            <Link href="/login" className="text-sm px-3 py-1 bg-primary text-white rounded">Sign in</Link>
            <Link href="/signup" className="text-sm px-3 py-1 border rounded">Sign up</Link>
          </div>
        </div>
      ) : null}
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-balance">Driver Behavior Monitor</h1>
            <div className="text-sm text-muted-foreground flex items-center gap-3">
              {user && user.devices && user.devices.length > 0 ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">Device</label>
                  <select
                    value={deviceId}
                    onChange={async (e) => {
                      const id = e.target.value
                      try {
                        await selectDevice(id)
                        setDeviceId(id)
                        // refresh the user's device list if needed
                        await listDevices().catch(() => {})
                      } catch (err) {
                        console.error('selectDevice failed', err)
                      }
                    }}
                    className="px-2 py-1 border rounded bg-background text-sm"
                  >
                    {user.devices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name ?? v.id}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <Link href="/choose-device" className="underline text-primary">Choose a device</Link>
              )}
              <button
                className="px-3 py-1 border rounded text-sm"
                onClick={() => {
                  logout()
                  router.push('/login')
                }}
              >
                Sign out
              </button>
            </div>
          </div>
          <p className="text-muted-foreground mt-1">Real-time driving performance analysis</p>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div className="flex flex-col text-right">
            <span className="text-sm text-muted-foreground">Journey Time: 12:34</span>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-xs text-muted-foreground">{now.toLocaleString()}</span>
              <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} title={isConnected ? 'Online' : 'Offline'} />
              <span className="text-xs text-muted-foreground">{isConnected ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Current Status Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className="border-2"
          style={{ borderColor: currentBehavior === "good" ? "var(--color-success)" : "var(--color-destructive)" }}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Behavior</CardTitle>
            {currentBehavior === "good" ? (
              <CheckCircle2 className="h-5 w-5" style={{ color: "var(--color-success)" }} />
            ) : (
              <AlertTriangle className="h-5 w-5" style={{ color: "var(--color-destructive)" }} />
            )}
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              style={{ color: currentBehavior === "good" ? "var(--color-success)" : "var(--color-destructive)" }}
            >
              {currentBehavior === "good" ? "GOOD" : "BAD"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Last 10s: {goodCount}/{last10Seconds.length} good</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Speed</CardTitle>
            <Gauge className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSpeed} km/h</div>
            <p className="text-xs text-muted-foreground mt-1">Average: {avgSpeed} km/h</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Engine RPM</CardTitle>
            <Activity className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rpm} rpm</div>
            <p className="text-xs text-muted-foreground mt-2">Real-time engine speed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Max Speed</CardTitle>
            <Activity className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{maxSpeed} km/h</div>
            <p className="text-xs text-muted-foreground mt-1">Peak velocity</p>
          </CardContent>
        </Card>
        {/* Telemetry log card */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Telemetry (latest)</CardTitle>
            <CardDescription>Raw telemetry packets received via socket (most recent first)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <pre className="text-xs bg-muted p-2 rounded max-h-40 overflow-auto">{lastTelemetry ? JSON.stringify(lastTelemetry, null, 2) : 'No telemetry yet'}</pre>
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">
              {telemetryLog.map((t, i) => (
                <div key={i} className="text-xs text-muted-foreground border-b pb-1">
                  <div><strong>{t.deviceId ?? 'unknown'}</strong> — {t.timestamp}</div>
                  <div>speed: {t.speed ?? '-'}, rpm: {t.engine_rpm ?? t.rpm ?? '-'}</div>
                </div>
              ))}
              {telemetryLog.length === 0 && <div className="text-xs text-muted-foreground">No telemetry received</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Behavior and Speed graphs side-by-side on md+ */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Journey Behavior Timeline</CardTitle>
            <CardDescription>Real-time behavior tracking throughout your journey</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                behavior: {
                  label: "Behavior",
                  color: "hsl(var(--chart-2))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={journeyData}>
                  <defs>
                    <linearGradient id="colorBehavior" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="time"
                    stroke="var(--color-muted-foreground)"
                    tick={{ fill: "var(--color-muted-foreground)" }}
                    label={{
                      value: "Time (seconds)",
                      position: "insideBottom",
                      offset: -5,
                      fill: "var(--color-muted-foreground)",
                    }}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    tick={{ fill: "var(--color-muted-foreground)" }}
                    ticks={[0, 1]}
                    tickFormatter={(value) => (value === 1 ? "Good" : "Bad")}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    formatter={(value: number) => [value === 1 ? "Good" : "Bad", "Behavior"]}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="behavior"
                    stroke="var(--color-success)"
                    fill="url(#colorBehavior)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Speed Analysis</CardTitle>
            <CardDescription>Speed variations throughout your journey</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                speed: {
                  label: "Speed (km/h)",
                  color: "hsl(var(--chart-1))",
                },
              }}
              className="h-[250px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={journeyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="time"
                    stroke="var(--color-muted-foreground)"
                    tick={{ fill: "var(--color-muted-foreground)" }}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    tick={{ fill: "var(--color-muted-foreground)" }}
                    label={{
                      value: "Speed (km/h)",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--color-muted-foreground)",
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="speed" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Historical Journeys */}
      {/* <Card>
        <CardHeader>
          <CardTitle>Journey History</CardTitle>
          <CardDescription>Performance overview of your past journeys</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              score: {
                label: "Score",
                color: "hsl(var(--chart-1))",
              },
            }}
            className="h-[300px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historicalJourneys}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--color-muted-foreground)"
                  tick={{ fill: "var(--color-muted-foreground)" }}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  tick={{ fill: "var(--color-muted-foreground)" }}
                  label={{
                    value: "Score (%)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--color-muted-foreground)",
                  }}
                />
                <ChartTooltip
                  content={<ChartTooltipContent />}
                  formatter={(value, name, props) => {
                    const data = props.payload
                    return [
                      <div key="tooltip" className="space-y-1">
                        <div>Score: {value}%</div>
                        <div className="text-xs text-muted-foreground">Duration: {data.duration}</div>
                        <div className="text-xs text-muted-foreground">Distance: {data.distance}</div>
                      </div>,
                    ]
                  }}
                />
                <Bar dataKey="score" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer> */}

          {/* Historical Journey Details */}
          {/* <div className="mt-6 space-y-3">
            {historicalJourneys.map((journey) => (
              <div key={journey.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-4">
                  <div className="text-sm font-medium">
                    {new Date(journey.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <Badge variant={journey.score >= 85 ? "default" : journey.score >= 70 ? "secondary" : "destructive"}>
                    {journey.score}%
                  </Badge>
                </div>
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                  <span>{journey.duration}</span>
                  <span>{journey.distance}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card> */}
    </div>
  )
}
