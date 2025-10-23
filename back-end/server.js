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
import Device from './models/device.js'

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
// app.post('/api/auth/register', async (req, res) => {
//   const { email, password, name, deviceName } = req.body
//   if (!email || !password) return res.status(400).json({ message: 'email and password required' })
//   try {
//     const user = new User({ email, password, name })
//     await user.save()

//     // Optionally create an initial device
//     // Accept optional deviceId and deviceName via initialDevice object for clients that provide an id
//     // Also keep backward compatible deviceName param
//     const initialDeivce = req.body.initialDevice || (deviceName ? { name: deviceName } : null)
//     if (initialDeivce) {
//       // allow client to pass initialDevice.deviceId; otherwise generate one
//       let { deviceId: providedId, name: initialName } = initialDeivce
//       const vName = initialName || deviceName || 'Unnamed'
//       if (providedId) {
//         // validate provided id: allow letters, numbers, hyphen, underscore
//         if (!/^[A-Za-z0-9_-]+$/.test(providedId)) {
//           return res.status(400).json({ message: 'Invalid deviceId format. Allowed: letters, numbers, -, _' })
//         }
//         // conflict check
//         const exists = await Device.findOne({ deviceId: providedId })
//         if (exists) {
//           return res.status(409).json({ message: 'deviceId already exists' })
//         }
//       } else {
//         // Do NOT auto-generate a deviceId — require the client to provide one
//         return res.status(400).json({ message: 'deviceId is required when creating an initial device' })
//       }
//       const deviceId = providedId
//       const v = new Device({ deviceId, name: vName, owner: user._id })
//       await v.save()
//       user.selectedDevice = v.deviceId
//       await user.save()
//     }

//     // build user object with devices list
//     const devices = await Device.find({ owner: user._id }).lean()
//     const userObj = {
//       id: user._id.toString(),
//       email: user.email,
//       name: user.name,
//       devices: devices.map((v) => ({ id: v.deviceId, name: v.name })),
//       selectedDevice: user.selectedDevice ?? null,
//     }
//     const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '12h' })
//     return res.json({ token, user: userObj })
//   } catch (err) {
//     console.error(err)
//     return res.status(400).json({ message: 'registration failed', error: err.message })
//   }
// })

app.post('/api/auth/register', async (req, res) => {
  const { email, password, deviceName } = req.body
  console.log('Registration attempt:', { email,  deviceName }) // Debug log
  
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password required' })
  }
  
  try {
    const user = new User({ email, password })
    await user.save()
    console.log('User created successfully:', user._id) // Debug log

    const initialDevice = deviceName ? { name: deviceName } : null
    console.log('Initial device data:', initialDevice

    ) // Debug log
    
    if (initialDevice) {
      let providedId = initialDevice.name
      console.log('Provided deviceId for initial device:', providedId) // Debug log
      
      if (providedId) {
        if (!/^[A-Za-z0-9_-]+$/.test(providedId)) {
          return res.status(400).json({ message: 'Invalid deviceId format. Allowed: letters, numbers, -, _' })
        }
        
        const exists = await Device.findOne({ deviceId: providedId })
        if (exists) {
          return res.status(409).json({ message: 'deviceId already exists' })
        }
      } else {
        return res.status(400).json({ message: 'deviceId is required when creating an initial device' })
      }
      
      const deviceId = providedId
      const device = new Device({ deviceId, owner: user._id })
      await device.save()
      
      user.selectedDevice = device.deviceId
      await user.save()
    }

    const devices = await Device.find({ owner: user._id }).lean()
    const userObj = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      devices: devices.map((v) => ({ id: v.deviceId })),
      selectedDevice: user.selectedDevice ?? null,
    }
    
    const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '12h' })
    return res.json({ token, user: userObj })
    
  } catch (err) {
    console.error('Registration error details:', err) // More detailed logging
    console.error('Error name:', err.name)
    console.error('Error code:', err.code)
    
    // Handle specific error types
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation failed', 
        error: err.message,
        details: Object.values(err.errors).map(e => e.message)
      })
    }
    
    if (err.code === 11000) { // MongoDB duplicate key
      return res.status(409).json({ 
        message: 'Email already exists' 
      })
    }
    
    return res.status(400).json({ 
      message: 'Registration failed', 
      error: err.message 
    })
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

    // gather user's devices
    const devices = await Device.find({ owner: user._id }).lean()
    const userObj = { id: user._id.toString(), email: user.email, name: user.name, devices: devices.map(v => ({ id: v.deviceId, name: v.name })), selectedDevice: user.selectedDevice }
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
  const devices = await Device.find({ owner: u._id }).lean()
  return res.json({ user: { id: u._id.toString(), email: u.email, name: u.name, devices: devices.map(v => ({ id: v.deviceId, name: v.name })), selectedDevice: u.selectedDevice } })
})

// devices list/create and select
app.get('/api/devices', authMiddleware, async (req, res) => {
  const devices = await Device.find({ owner: req.user.id }).lean()
  const user = await User.findById(req.user.id)
  return res.json({ devices: devices.map(v => ({ id: v.deviceId, name: v.name })), selectedDevice: user?.selectedDevice ?? null })
})

// Debug: show authenticated user id and selected device
app.get('/api/debug/whoami', authMiddleware, async (req, res) => {
  const u = await User.findById(req.user.id).lean()
  if (!u) return res.status(404).json({ message: 'User not found' })
  const devices = await Device.find({ owner: req.user.id }).lean()
  const selectedDevice = u.selectedDevice ?? null
  console.log(`DEBUG /whoami: user=${req.user.id}, selectedDevice=${selectedDevice}`)
  return res.json({ userId: req.user.id, selectedDevice, devices: devices.map(v => ({ id: v.DeviceId, name: v.name })) })
})

app.post('/api/devices', authMiddleware, async (req, res) => {
  const { deviceId } = req.body

  if (deviceId) {
    // validate provided id: must be like ABC-1234
    // if (!/^[A-Z]{3}-\d{4}$/.test(deviceId)) {
    //   return res.status(400).json({
    //     message: 'Invalid deviceId format. Format must be: 3 capital letters, a hyphen, and 4 numbers (e.g., ABC-1234)',
    //   })
    // }

    // check conflict
    const exists = await Device.findOne({ deviceId })
    if (exists) {
      // If exists and owned by this user, return it; otherwise conflict
      if (String(exists.owner) === String(req.user.id)) {
        // set as selected and return existing
        await User.findByIdAndUpdate(req.user.id, { selectedDevice: deviceId })
        return res.json({ device: { id: exists.deviceId } })
      }
      return res.status(409).json({ message: 'deviceId already exists' })
    }
  } else {
    // Do NOT auto-generate device IDs; require the client to provide one
    return res.status(400).json({ message: 'deviceId is required' })
  }

  const v = new Device({ deviceId, owner: req.user.id })
  await v.save()
  // set as selected
  await User.findByIdAndUpdate(req.user.id, { selectedDevice: v.deviceId })
  return res.json({ device: { id: v.deviceId} })
})

app.post('/api/select-device', authMiddleware, async (req, res) => {
  const { deviceId } = req.body
  if (!deviceId) return res.status(400).json({ message: 'deviceId required' })
  const device = await Device.findOne({ deviceId })
  if (!device) return res.status(404).json({ message: 'device not found' })
  if (String(device.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Not owner of device' })
  await User.findByIdAndUpdate(req.user.id, { selectedDevice: deviceId })
  return res.json({ selectedDevice: deviceId })
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

// Socket.IO connections: enforce that sockets only subscribe to devices they own
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}, userId=${socket.data.userId}`)
  // auto-join user's selected device room (if any)
  ;(async () => {
    try {
      const u = await User.findById(socket.data.userId)
      if (u && u.selectedDevice) {
        const device = await Device.findOne({ deviceId: u.selectedDevice })
        if (device && String(device.owner) === String(socket.data.userId)) {
          socket.join(u.selectedDevice)
          console.log(`➡️ Socket ${socket.id} auto-joined selected device room ${u.selectedDevice}`)
          socket.emit('subscribed', { deviceId: u.selectedDevice })
        }
      }
    } catch (err) {
      console.error('Error auto-joining selected device for socket', err)
    }
  })()
  socket.on('subscribe', async (deviceId) => {
    if (!deviceId) return
    // check ownership
    const device = await Device.findOne({ deviceId })
    if (!device) return socket.emit('error', { message: 'device not found' })
    if (String(device.owner) !== String(socket.data.userId)) {
      console.warn(`⛔ Unauthorized subscribe by ${socket.data.userId} to device ${deviceId}`)
      return socket.emit('error', { message: 'Unauthorized to subscribe to this deviceId' })
    }
    socket.join(deviceId)
    console.log(`➡️ Socket ${socket.id} joined room ${deviceId}`)
    socket.emit('subscribed', { deviceId })
  })
  socket.on('unsubscribe', (deviceId) => {
    if (!deviceId) return
    socket.leave(deviceId)
    socket.emit('unsubscribed', { deviceId })
  })

  // debug: client can ask who they are
  socket.on('whoami', async (cb) => {
    try {
      const u = await User.findById(socket.data.userId).lean()
      const selectedDevice = u?.selectedDevice ?? null
      console.log(`DEBUG socket.whoami: socket=${socket.id}, user=${socket.data.userId}, selectedDevice=${selectedDevice}`)
      if (typeof cb === 'function') cb({ userId: socket.data.userId, selectedDevice })
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
  const topicToSubscribe = process.env.MQTT_TOPIC || 'devices/+/telemetry'
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

    // Extract deviceId from topic (expected: devices/{deviceId}/telemetry)
    const topicMatch = String(topic).match(/^devices\/([^/]+)\/telemetry$/)
    if (!topicMatch) {
      console.warn(`⚠️ Received message on unexpected topic format: ${topic}`)
      return
    }
    const deviceIdFromTopic = topicMatch[1]

    const data = JSON.parse(message.toString())
    // Prefer deviceId from topic as authoritative source
    const { speed, behavior_status, engine_rpm, timestamp } = data
    const deviceId = deviceIdFromTopic

    // Resolve device and owner before saving so telemetry is associated with a user
    const device = await Device.findOne({ deviceId })
    if (!device) {
      console.warn(`⚠️ Received telemetry for unknown deviceId='${deviceId}' — skipping save`)
    } else {
      const record = new Telemetry({
        deviceId,
        userId: device.owner,
        speed,
        behavior_status,
        engine_rpm,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      })

      record.save()
        .then((doc) => console.log(`💾 Telemetry saved for device ${deviceId}, _id=${doc._id}, user=${device.owner}`))
        .catch((saveErr) => console.error("❌ Error saving telemetry:", saveErr))
    }

    // Emit live data to frontend via WebSocket to the device-specific room
    if (deviceId) {
      io.to(String(deviceId)).emit("telemetry", data)
    } else {
      // fallback: broadcast if no deviceId present
      io.emit("telemetry", data)
    }
  } catch (err) {
    console.error("❌ Error handling MQTT message:", err)
  }
})

// --- REST Endpoints ---

// Latest data for a specific device
app.get("/api/telemetry/:deviceId/latest", async (req, res) => {
  const data = await Telemetry.findOne({ deviceId: req.params.deviceId })
    .sort({ timestamp: -1 })
    .lean()
  res.json(data || {})
})

// Recent historical data
app.get("/api/telemetry/:deviceId/history", async (req, res) => {
  const data = await Telemetry.find({ deviceId: req.params.deviceId })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean()
  res.json(data)
})

// Aggregated journey summary (avg speed, good%, etc.)
app.get("/api/telemetry/:deviceId/summary", async (req, res) => {
  const deviceId = req.params.deviceId
  const recent = await Telemetry.aggregate([
    { $match: { deviceId } },
    {
      $group: {
        _id: "$deviceId",
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
          deviceId,
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
