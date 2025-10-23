import mongoose from 'mongoose'

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
})

export default mongoose.model('Device', DeviceSchema)
