import express from "express"
import { createServer } from "http"
import { Server as SocketServer } from "socket.io"
import mqtt from "mqtt"
import cors from "cors"
import dotenv from "dotenv"
import mongoose from "mongoose"
import { connectDB } from "./db.js"
import jwt from 'jsonwebtoken'
import Telemetry from "./models/telemetry.js"
import User from './models/user.js'
import Vehicle from './models/vehicle.js'

dotenv.config()

// Startup sanity checks for required env vars
const requiredEnvs = ['MONGO_URI', 'JWT_SECRET', 'MQTT_BROKER']
const missing = requiredEnvs.filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error('Missing required environment variables:', missing.join(', '))
  console.error('Please add them to your .env file or environment before starting the server.')
  process.exit(1)
}

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)
const io = new SocketServer(httpServer, {
  cors: { origin: "*" },
})

// REST auth helpers
const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' })
  const token = auth.split(' ')[1]
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { id: payload.sub }
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// Auth endpoints: register & login
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, vehicleName } = req.body
  if (!email || !password) return res.status(400).json({ message: 'email and password required' })
  try {
    const user = new User({ email, password, name })
    await user.save()

    // Optionally create an initial vehicle
    // Accept optional vehicleId and vehicleName via initialVehicle object for clients that provide an id
    // Also keep backward compatible vehicleName param
    const initialVehicle = req.body.initialVehicle || (vehicleName ? { name: vehicleName } : null)
    if (initialVehicle) {
      // allow client to pass initialVehicle.vehicleId; otherwise generate one
      let { vehicleId: providedId, name: initialName } = initialVehicle
      const vName = initialName || vehicleName || 'Unnamed'
      if (providedId) {
        // validate provided id: allow letters, numbers, hyphen, underscore
        if (!/^[A-Za-z0-9_-]+$/.test(providedId)) {
          return res.status(400).json({ message: 'Invalid vehicleId format. Allowed: letters, numbers, -, _' })
        }
        // conflict check
        const exists = await Vehicle.findOne({ vehicleId: providedId })
        if (exists) {
          return res.status(409).json({ message: 'vehicleId already exists' })
        }
      } else {
        // Do NOT auto-generate a vehicleId — require the client to provide one
        return res.status(400).json({ message: 'vehicleId is required when creating an initial vehicle' })
      }
      const vehicleId = providedId
      const v = new Vehicle({ vehicleId, name: vName, owner: user._id })
      await v.save()
      user.selectedVehicle = v.vehicleId
      await user.save()
    }

    // build user object with vehicles list
    const vehicles = await Vehicle.find({ owner: user._id }).lean()
    const userObj = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      vehicles: vehicles.map((v) => ({ id: v.vehicleId, name: v.name })),
      selectedVehicle: user.selectedVehicle ?? null,
    }
    const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '12h' })
    return res.json({ token, user: userObj })
  } catch (err) {
    console.error(err)
    return res.status(400).json({ message: 'registration failed', error: err.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ message: 'email and password required' })
    const user = await User.findOne({ email })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })
    const ok = await user.comparePassword(password)
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' })
    const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '12h' })

    // gather user's vehicles
    const vehicles = await Vehicle.find({ owner: user._id }).lean()
    const userObj = { id: user._id.toString(), email: user.email, name: user.name, vehicles: vehicles.map(v => ({ id: v.vehicleId, name: v.name })), selectedVehicle: user.selectedVehicle }
    return res.json({ token, user: userObj })
  } catch (err) {
    console.error('/api/auth/login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// Protected route: get current user
app.get('/api/me', authMiddleware, async (req, res) => {
  const u = await User.findById(req.user.id)
  if (!u) return res.status(404).json({ message: 'User not found' })
  const vehicles = await Vehicle.find({ owner: u._id }).lean()
  return res.json({ user: { id: u._id.toString(), email: u.email, name: u.name, vehicles: vehicles.map(v => ({ id: v.vehicleId, name: v.name })), selectedVehicle: u.selectedVehicle } })
})

// Vehicles list/create and select
app.get('/api/vehicles', authMiddleware, async (req, res) => {
  const vehicles = await Vehicle.find({ owner: req.user.id }).lean()
  const user = await User.findById(req.user.id)
  return res.json({ vehicles: vehicles.map(v => ({ id: v.vehicleId, name: v.name })), selectedVehicle: user?.selectedVehicle ?? null })
})

// Debug: show authenticated user id and selected vehicle
app.get('/api/debug/whoami', authMiddleware, async (req, res) => {
  const u = await User.findById(req.user.id).lean()
  if (!u) return res.status(404).json({ message: 'User not found' })
  const vehicles = await Vehicle.find({ owner: req.user.id }).lean()
  const selectedVehicle = u.selectedVehicle ?? null
  console.log(`DEBUG /whoami: user=${req.user.id}, selectedVehicle=${selectedVehicle}`)
  return res.json({ userId: req.user.id, selectedVehicle, vehicles: vehicles.map(v => ({ id: v.vehicleId, name: v.name })) })
})

app.post('/api/vehicles', authMiddleware, async (req, res) => {
  const { vehicleId } = req.body

  if (vehicleId) {
    // validate provided id: must be like ABC-1234
    if (!/^[A-Z]{3}-\d{4}$/.test(vehicleId)) {
      return res.status(400).json({
        message: 'Invalid vehicleId format. Format must be: 3 capital letters, a hyphen, and 4 numbers (e.g., ABC-1234)',
      })
    }

    // check conflict
    const exists = await Vehicle.findOne({ vehicleId })
    if (exists) {
      // If exists and owned by this user, return it; otherwise conflict
      if (String(exists.owner) === String(req.user.id)) {
        // set as selected and return existing
        await User.findByIdAndUpdate(req.user.id, { selectedVehicle: vehicleId })
        return res.json({ vehicle: { id: exists.vehicleId } })
      }
      return res.status(409).json({ message: 'vehicleId already exists' })
    }
  } else {
    // Do NOT auto-generate vehicle IDs; require the client to provide one
    return res.status(400).json({ message: 'vehicleId is required' })
  }

  const v = new Vehicle({ vehicleId, owner: req.user.id })
  await v.save()
  // set as selected
  await User.findByIdAndUpdate(req.user.id, { selectedVehicle: v.vehicleId })
  return res.json({ vehicle: { id: v.vehicleId} })
})

app.post('/api/select-vehicle', authMiddleware, async (req, res) => {
  const { vehicleId } = req.body
  if (!vehicleId) return res.status(400).json({ message: 'vehicleId required' })
  const vehicle = await Vehicle.findOne({ vehicleId })
  if (!vehicle) return res.status(404).json({ message: 'vehicle not found' })
  if (String(vehicle.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Not owner of vehicle' })
  await User.findByIdAndUpdate(req.user.id, { selectedVehicle: vehicleId })
  return res.json({ selectedVehicle: vehicleId })
})

// Socket.IO JWT auth: expect token in handshake.auth.token
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token
    if (!token) return next(new Error('Authentication error: token required'))
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    socket.data.userId = payload.sub
    return next()
  } catch (err) {
    return next(new Error('Authentication error: ' + err.message))
  }
})

// Socket.IO connections: enforce that sockets only subscribe to vehicles they own
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}, userId=${socket.data.userId}`)
  // auto-join user's selected vehicle room (if any)
  ;(async () => {
    try {
      const u = await User.findById(socket.data.userId)
      if (u && u.selectedVehicle) {
        const vehicle = await Vehicle.findOne({ vehicleId: u.selectedVehicle })
        if (vehicle && String(vehicle.owner) === String(socket.data.userId)) {
          socket.join(u.selectedVehicle)
          console.log(`➡️ Socket ${socket.id} auto-joined selected vehicle room ${u.selectedVehicle}`)
          socket.emit('subscribed', { vehicleId: u.selectedVehicle })
        }
      }
    } catch (err) {
      console.error('Error auto-joining selected vehicle for socket', err)
    }
  })()
  socket.on('subscribe', async (vehicleId) => {
    if (!vehicleId) return
    // check ownership
    const vehicle = await Vehicle.findOne({ vehicleId })
    if (!vehicle) return socket.emit('error', { message: 'vehicle not found' })
    if (String(vehicle.owner) !== String(socket.data.userId)) {
      console.warn(`⛔ Unauthorized subscribe by ${socket.data.userId} to vehicle ${vehicleId}`)
      return socket.emit('error', { message: 'Unauthorized to subscribe to this vehicleId' })
    }
    socket.join(vehicleId)
    console.log(`➡️ Socket ${socket.id} joined room ${vehicleId}`)
    socket.emit('subscribed', { vehicleId })
  })
  socket.on('unsubscribe', (vehicleId) => {
    if (!vehicleId) return
    socket.leave(vehicleId)
    socket.emit('unsubscribed', { vehicleId })
  })

  // debug: client can ask who they are
  socket.on('whoami', async (cb) => {
    try {
      const u = await User.findById(socket.data.userId).lean()
      const selectedVehicle = u?.selectedVehicle ?? null
      console.log(`DEBUG socket.whoami: socket=${socket.id}, user=${socket.data.userId}, selectedVehicle=${selectedVehicle}`)
      if (typeof cb === 'function') cb({ userId: socket.data.userId, selectedVehicle })
    } catch (err) {
      console.error('Error in whoami handler', err)
      if (typeof cb === 'function') cb({ error: 'server error' })
    }
  })
})

// --- Connect to MongoDB ---
await connectDB()
// Print MongoDB connection info for debugging
console.log(
  `MongoDB connection: readyState=${mongoose.connection.readyState}, name=${mongoose.connection.name}, host=${mongoose.connection.host}`
)

// --- MQTT Setup ---
const mqttClient = mqtt.connect(process.env.MQTT_BROKER)

mqttClient.on("connect", () => {
  console.log("📡 Connected to MQTT Broker")
  const topicToSubscribe = process.env.MQTT_TOPIC || 'vehicles/+/telemetry'
  mqttClient.subscribe(topicToSubscribe, (err) => {
    if (!err) console.log("✅ Subscribed to", topicToSubscribe)
    else console.error('❌ MQTT subscribe error', err)
  })
})

// MQTT diagnostic event handlers (helps understand why messages stop)
mqttClient.on("reconnect", () => console.warn("🔁 MQTT client reconnecting..."))
mqttClient.on("close", () => console.warn("❌ MQTT connection closed"))
mqttClient.on("offline", () => console.warn("⚠️ MQTT client is offline"))
mqttClient.on("error", (err) => console.error("❌ MQTT error:", err))
mqttClient.on("packetsend", (packet) => console.debug("⬆️ MQTT packet sent:", packet && packet.cmd))
mqttClient.on("packetreceive", (packet) => console.debug("⬇️ MQTT packet received:", packet && packet.cmd))

// Mongoose connection events
mongoose.connection.on("disconnected", () => console.warn("❌ MongoDB disconnected"))
mongoose.connection.on("reconnected", () => console.log("🔁 MongoDB reconnected"))
mongoose.connection.on("error", (err) => console.error("❌ MongoDB connection error:", err))

// Global handlers to catch unexpected failures that might stop processing
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception:", err)
})
process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled rejection at:", promise, "reason:", reason)
})

// --- On MQTT Message ---
mqttClient.on("message", async (topic, message) => {
  try {
    // Log raw MQTT message to terminal for debugging
    console.log(`📥 MQTT message received on '${topic}': ${message.toString()}`)

    // Extract vehicleId from topic (expected: vehicles/{vehicleId}/telemetry)
    const topicMatch = String(topic).match(/^vehicles\/([^/]+)\/telemetry$/)
    if (!topicMatch) {
      console.warn(`⚠️ Received message on unexpected topic format: ${topic}`)
      return
    }
    const vehicleIdFromTopic = topicMatch[1]

    const data = JSON.parse(message.toString())
    // Prefer vehicleId from topic as authoritative source
    const { speed, behavior_status, engine_rpm, timestamp } = data
    const vehicleId = vehicleIdFromTopic

    // Resolve vehicle and owner before saving so telemetry is associated with a user
    const vehicle = await Vehicle.findOne({ vehicleId })
    if (!vehicle) {
      console.warn(`⚠️ Received telemetry for unknown vehicleId='${vehicleId}' — skipping save`)
    } else {
      const record = new Telemetry({
        vehicleId,
        userId: vehicle.owner,
        speed,
        behavior_status,
        engine_rpm,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      })

      record.save()
        .then((doc) => console.log(`💾 Telemetry saved for vehicle ${vehicleId}, _id=${doc._id}, user=${vehicle.owner}`))
        .catch((saveErr) => console.error("❌ Error saving telemetry:", saveErr))
    }

    // Emit live data to frontend via WebSocket to the vehicle-specific room
    if (vehicleId) {
      io.to(String(vehicleId)).emit("telemetry", data)
    } else {
      // fallback: broadcast if no vehicleId present
      io.emit("telemetry", data)
    }
  } catch (err) {
    console.error("❌ Error handling MQTT message:", err)
  }
})

// --- REST Endpoints ---

// Latest data for a specific vehicle
app.get("/api/telemetry/:vehicleId/latest", async (req, res) => {
  const data = await Telemetry.findOne({ vehicleId: req.params.vehicleId })
    .sort({ timestamp: -1 })
    .lean()
  res.json(data || {})
})

// Recent historical data
app.get("/api/telemetry/:vehicleId/history", async (req, res) => {
  const data = await Telemetry.find({ vehicleId: req.params.vehicleId })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean()
  res.json(data)
})

// Aggregated journey summary (avg speed, good%, etc.)
app.get("/api/telemetry/:vehicleId/summary", async (req, res) => {
  const vehicleId = req.params.vehicleId
  const recent = await Telemetry.aggregate([
    { $match: { vehicleId } },
    {
      $group: {
        _id: "$vehicleId",
        avgSpeed: { $avg: "$speed" },
        maxSpeed: { $max: "$speed" },
        goodCount: {
          $sum: { $cond: [{ $eq: ["$behavior", "good"] }, 1, 0] },
        },
        totalCount: { $sum: 1 },
      },
    },
  ])
  const result =
    recent.length > 0
      ? {
          vehicleId,
          avgSpeed: recent[0].avgSpeed.toFixed(2),
          maxSpeed: recent[0].maxSpeed,
          behaviorScore: Math.round(
            (recent[0].goodCount / recent[0].totalCount) * 100
          ),
        }
      : {}

  res.json(result)
})

// --- Start Server with port fallback ---
const BASE_PORT = parseInt(process.env.PORT || '4000', 10)
const MAX_PORT = BASE_PORT + 10

async function listenWithFallback(startPort, endPort) {
  for (let p = startPort; p <= endPort; p++) {
    try {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(p, () => {
          httpServer.removeListener('error', reject)
          resolve()
        })
      })
      console.log(`🚀 Server running on http://localhost:${p}`)
      return p
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${p} is in use, trying next port...`)
        continue
      }
      console.error('Server listen error:', err)
      process.exit(1)
    }
  }
  console.error(`No available ports in range ${startPort}-${endPort}`)
  process.exit(1)
}

listenWithFallback(BASE_PORT, MAX_PORT)
