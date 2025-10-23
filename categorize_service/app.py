import json
import time
import logging
from typing import Dict, Optional
from dataclasses import dataclass, asdict
from datetime import datetime
import paho.mqtt.client as mqtt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('driving_behavior_processor.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class VehicleState:
    """Stores the previous state for a vehicle"""
    last_timestamp: float
    last_speed: float
    last_rpm: float
    last_throttle: float
    last_update: float = 0.0  # For state expiration


@dataclass
class ProcessedData:
    """Structured output after processing"""
    vehicle_id: str
    timestamp: float
    speed: float
    engine_rpm: float
    engine_load: float
    throttle_pos: float
    delta_t: float
    speed_d: float
    rpm_d: float
    throttle_d: float
    rcz: float
    rjz: float
    behavior_label: int  # 1 = good, 0 = bad
    behavior_status: str  # 'good' or 'bad'


class DrivingBehaviorProcessor:
    """
    Processes real-time driving data from MQTT and categorizes behavior.
    Maintains state per vehicle_id for temporal feature calculation.
    """

    def __init__(
        self,
        mqtt_broker: str,
        mqtt_port: int = 1883,
        input_topic: str = "vehicles/+/telemetry_raw",
        output_topic: str = "vehicles/{vehicleId}/telemetry",
        state_expiry_seconds: int = 1800,  # 30 minutes
        global_max_throttle_d: float = 100.0,  # From training data
        global_max_rpm_d: float = 1000.0,  # From training data
    ):
        self.mqtt_broker = mqtt_broker
        self.mqtt_port = mqtt_port
        self.input_topic = input_topic
        self.output_topic = output_topic
        self.state_expiry = state_expiry_seconds

        # Fixed normalization constants for Rcz calculation
        self.MAX_SPEED = 220.0  # km/h
        self.MAX_RPM = 8000.0  # RPM

        # Global normalization constants for Rjz (from historical data analysis)
        self.GLOBAL_MAX_THROTTLE_D = global_max_throttle_d
        self.GLOBAL_MAX_RPM_D = global_max_rpm_d

        # State storage: {vehicle_id: VehicleState}
        self.vehicle_states: Dict[str, VehicleState] = {}

        # Statistics tracking
        self.stats = {
            'total_processed': 0,
            'good_behavior': 0,
            'bad_behavior': 0,
            'vehicles_tracked': 0,
        }

        # MQTT client setup
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_subscribe = self.on_subscribe

        logger.info(f"Initialized DrivingBehaviorProcessor")
        logger.info(f"Broker: {mqtt_broker}:{mqtt_port}")
        logger.info(f"Input topic: {input_topic}, Output topic: {output_topic}")
        logger.info(f"Constants - MAX_SPEED: {self.MAX_SPEED}, MAX_RPM: {self.MAX_RPM}")

    def on_connect(self, client, userdata, flags, rc):
        """Callback when connected to MQTT broker"""
        if rc == 0:
            logger.info(f"Successfully connected to MQTT broker")
            result, mid = client.subscribe(self.input_topic)
            logger.info(f"Subscribe request sent to '{self.input_topic}' (result={result}, mid={mid})")
        else:
            logger.error(f"Failed to connect to MQTT broker with result code {rc}")

    def on_subscribe(self, client, userdata, mid, granted_qos):
        """Callback when subscription is acknowledged"""
        logger.info(f"Successfully subscribed (mid={mid}, qos={granted_qos})")

    def on_message(self, client, userdata, msg):
        """Callback when message received"""
        try:
            # Parse incoming JSON message
            payload = json.loads(msg.payload.decode())
            # Print raw received payload so the exact incoming values are visible
            print(f"[processor] RAW RECEIVED on '{msg.topic}': {payload}")
            logger.debug(f"Received message on '{msg.topic}': {payload}")

            # Extract vehicle_id from topic if not in payload
            # Expected topic format: vehicles/{vehicleId}/telemetry_raw
            if 'vehicle_id' not in payload:
                topic_parts = msg.topic.split('/')
                if len(topic_parts) >= 2:
                    payload['vehicle_id'] = topic_parts[1]
                else:
                    logger.error(f"Cannot extract vehicle_id from topic: {msg.topic}")
                    return

            # Normalize field names from different publishers
            if 'engine_rpm' not in payload and 'rpm' in payload:
                payload['engine_rpm'] = float(payload['rpm'])

            if 'throttle_pos' not in payload and 'throttle_position' in payload:
                payload['throttle_pos'] = float(payload['throttle_position'])

            # Normalize timestamp: accept ISO8601 string or numeric
            if 'timestamp' in payload:
                ts = payload['timestamp']
                if isinstance(ts, str):
                    try:
                        # Try ISO format like 2025-08-11T09:20:00Z
                        payload['timestamp'] = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                    except ValueError:
                        # Try numeric string
                        payload['timestamp'] = float(ts)

            # Validate timestamp exists after normalization
            if 'timestamp' not in payload:
                logger.warning(f"Message missing timestamp, skipping: {payload}")
                return

            # Process the data
            result = self.process_vehicle_data(payload)

            # Publish result if processing was successful
            if result:
                # Format output topic with vehicle_id if needed
                out_topic = self.output_topic.format(vehicleId=result.vehicle_id)
                output_payload = json.dumps(asdict(result))
                
                client.publish(out_topic, output_payload)
                logger.debug(f"Published to '{out_topic}'")

                # Update statistics
                self.stats['total_processed'] += 1
                if result.behavior_label == 1:
                    self.stats['good_behavior'] += 1
                else:
                    self.stats['bad_behavior'] += 1

                logger.info(
                    f"[{result.vehicle_id}] {result.behavior_status.upper()} | "
                    f"Rcz={result.rcz:.3f}, Rjz={result.rjz:.3f}, Load={result.engine_load:.1f}"
                )

                # Log statistics every 100 messages
                if self.stats['total_processed'] % 100 == 0:
                    self._log_statistics()

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON message: {e}")
        except KeyError as e:
            logger.error(f"Missing required field in message: {e}")
        except ValueError as e:
            logger.error(f"Invalid value in message: {e}")
        except Exception as e:
            logger.error(f"Error processing message: {e}", exc_info=True)

    def process_vehicle_data(self, data: Dict) -> Optional[ProcessedData]:
        """
        Main processing function: calculates features and categorizes behavior

        Expected input format:
        {
            "vehicle_id": "ABC123",
            "timestamp": 1634567890.123,
            "speed": 65.5,
            "engine_rpm": 2500,
            "engine_load": 35.2,
            "throttle_pos": 45.8
        }
        """
        vehicle_id = data['vehicle_id']
        current_time = time.time()

        # Clean stale states
        self._clean_expired_states(current_time)

        # Extract current values
        timestamp = data['timestamp']
        speed = data['speed']
        engine_rpm = data['engine_rpm']
        engine_load = data['engine_load']
        throttle_pos = data['throttle_pos']

        # Check if we have previous state for this vehicle
        if vehicle_id not in self.vehicle_states:
            # First data point for this vehicle - initialize state
            self.vehicle_states[vehicle_id] = VehicleState(
                last_timestamp=timestamp,
                last_speed=speed,
                last_rpm=engine_rpm,
                last_throttle=throttle_pos,
                last_update=current_time,
            )
            self.stats['vehicles_tracked'] = len(self.vehicle_states)
            logger.info(f"Initialized state for new vehicle: {vehicle_id}")
            logger.debug(f"Total vehicles being tracked: {self.stats['vehicles_tracked']}")
            return None  # Cannot calculate derivatives yet

        # Get previous state
        prev_state = self.vehicle_states[vehicle_id]

        # Calculate time delta
        delta_t = timestamp - prev_state.last_timestamp

        # Sanity check: avoid division by zero or negative time
        if delta_t <= 0:
            logger.warning(
                f"Invalid time delta for {vehicle_id}: {delta_t}s "
                f"(current: {timestamp}, previous: {prev_state.last_timestamp})"
            )
            return None

        # Calculate derivatives (rates of change)
        speed_d = (speed - prev_state.last_speed) / delta_t
        rpm_d = (engine_rpm - prev_state.last_rpm) / delta_t
        throttle_d = (throttle_pos - prev_state.last_throttle) / delta_t

        logger.debug(
            f"[{vehicle_id}] Derivatives - speed_d={speed_d:.2f}, "
            f"rpm_d={rpm_d:.2f}, throttle_d={throttle_d:.2f}"
        )

        # Calculate Rcz (Speed vs RPM Ratio)
        rcz = self._calculate_rcz(speed, engine_rpm)

        # Calculate Rjz (Throttle change vs RPM change Ratio)
        rjz = self._calculate_rjz(throttle_d, rpm_d)

        # Categorize behavior
        behavior_label = self._categorize_behavior(rcz, rjz, engine_load)
        behavior_status = 'good' if behavior_label == 1 else 'bad'

        # Update state for next iteration
        self.vehicle_states[vehicle_id] = VehicleState(
            last_timestamp=timestamp,
            last_speed=speed,
            last_rpm=engine_rpm,
            last_throttle=throttle_pos,
            last_update=current_time
        )

        # Return processed data
        return ProcessedData(
            vehicle_id=vehicle_id,
            timestamp=timestamp,
            speed=speed,
            engine_rpm=engine_rpm,
            engine_load=engine_load,
            throttle_pos=throttle_pos,
            delta_t=delta_t,
            speed_d=speed_d,
            rpm_d=rpm_d,
            throttle_d=throttle_d,
            rcz=rcz,
            rjz=rjz,
            behavior_label=behavior_label,
            behavior_status=behavior_status
        )

    def _calculate_rcz(self, speed: float, rpm: float) -> float:
        """
        Calculate Rcz: Speed vs RPM Ratio
        Rcz = (SPEED / 220.0) / (ENGINE_RPM / 8000.0)
        """
        if rpm == 0:
            logger.warning(f"RPM is zero, cannot calculate Rcz")
            return 0.0
        rcz = (speed / self.MAX_SPEED) / (rpm / self.MAX_RPM)
        return rcz

    def _calculate_rjz(self, throttle_d: float, rpm_d: float) -> float:
        """
        Calculate Rjz: Throttle change vs RPM change Ratio
        Rjz = (throttle_d / max_throttle_d) / (rpm_d / max_rpm_d)

        Uses global constants for normalization (from training data)
        """
        normalized_throttle_d = throttle_d / self.GLOBAL_MAX_THROTTLE_D
        normalized_rpm_d = rpm_d / self.GLOBAL_MAX_RPM_D

        if normalized_rpm_d == 0:
            logger.debug(f"Normalized RPM derivative is zero, Rjz set to 0.0")
            return 0.0

        rjz = normalized_throttle_d / normalized_rpm_d
        return rjz

    def _categorize_behavior(
        self,
        rcz: float,
        rjz: float,
        engine_load: float
    ) -> int:
        """
        Categorize driving behavior as good (1) or bad (0)

        Good behavior requires ALL conditions:
        - 0.9 <= Rcz <= 1.3
        - 0.9 <= Rjz <= 1.3
        - 20 <= ENGINE_LOAD <= 50
        """
        rcz_good = 0.9 <= rcz <= 1.3
        rjz_good = 0.9 <= rjz <= 1.3
        load_good = 20 <= engine_load <= 50

        result = 1 if (rcz_good and rjz_good and load_good) else 0

        if result == 0:
            reasons = []
            if not rcz_good:
                reasons.append(f"Rcz={rcz:.3f} out of range [0.9-1.3]")
            if not rjz_good:
                reasons.append(f"Rjz={rjz:.3f} out of range [0.9-1.3]")
            if not load_good:
                reasons.append(f"Load={engine_load:.1f} out of range [20-50]")
            logger.debug(f"Bad behavior detected: {', '.join(reasons)}")

        return result

    def _clean_expired_states(self, current_time: float):
        """Remove stale vehicle states"""
        expired_vehicles = [
            vid for vid, state in self.vehicle_states.items()
            if current_time - state.last_update > self.state_expiry
        ]
        if expired_vehicles:
            for vid in expired_vehicles:
                del self.vehicle_states[vid]
                logger.info(f"Removed expired state for vehicle: {vid}")
            self.stats['vehicles_tracked'] = len(self.vehicle_states)
            logger.info(f"Active vehicles: {self.stats['vehicles_tracked']}")

    def _log_statistics(self):
        """Log processing statistics"""
        total = self.stats['total_processed']
        good = self.stats['good_behavior']
        bad = self.stats['bad_behavior']
        good_pct = (good / total * 100) if total > 0 else 0
        bad_pct = (bad / total * 100) if total > 0 else 0

        logger.info("=" * 60)
        logger.info(f"STATISTICS - Total Processed: {total}")
        logger.info(f"Good Behavior: {good} ({good_pct:.1f}%)")
        logger.info(f"Bad Behavior: {bad} ({bad_pct:.1f}%)")
        logger.info(f"Active Vehicles: {self.stats['vehicles_tracked']}")
        logger.info("=" * 60)

    def start(self):
        """Start the MQTT client and begin processing"""
        logger.info("=" * 60)
        logger.info("Starting MQTT Driving Behavior Processor")
        logger.info("=" * 60)
        self.client.connect(self.mqtt_broker, self.mqtt_port, 60)
        self.client.loop_forever()

    def stop(self):
        """Stop the MQTT client"""
        self._log_statistics()
        self.client.disconnect()
        logger.info("MQTT processor stopped gracefully")


# Usage Example
if __name__ == "__main__":
    processor = DrivingBehaviorProcessor(
        mqtt_broker="localhost",
        mqtt_port=1883,
        input_topic="vehicles/+/telemetry_raw",
        output_topic="vehicles/{vehicleId}/telemetry",
        state_expiry_seconds=1800,
        global_max_throttle_d=100.0,  # Set from your training data
        global_max_rpm_d=1000.0       # Set from your training data
    )

    try:
        processor.start()
    except KeyboardInterrupt:
        processor.stop()