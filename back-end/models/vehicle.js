import mongoose from 'mongoose'

const VehicleSchema = new mongoose.Schema({
  vehicleId: { type: String, required: true, unique: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
})

export default mongoose.model('Vehicle', VehicleSchema)
