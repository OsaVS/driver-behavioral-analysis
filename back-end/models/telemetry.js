import mongoose from "mongoose"

const TelemetrySchema = new mongoose.Schema({
  vehicleId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  speed: { type: Number, required: true },
  // include 'average' as a valid behavior
  behavior_status: { type: String, enum: ["good", "bad"], required: true },
  engine_rpm: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
})

// Optional: create index for faster queries
TelemetrySchema.index({ vehicleId: 1, timestamp: -1 })

export default mongoose.model("Telemetry", TelemetrySchema)
