import json
import time
import paho.mqtt.client as mqtt

BROKER = "localhost"
PORT = 1883

def publish_once(vehicle_id="CAD-7002"):
    client = mqtt.Client(client_id="test-pub")
    client.connect(BROKER, PORT, 60)
    client.loop_start()
    payload = {
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "rpm": 2500,
        "speed": 72,
        "throttle_position": 45,
        "engine_load": 60
    }
    topic = f"vehicles/{vehicle_id}/telemetry_raw"
    info = client.publish(topic, json.dumps(payload), qos=1)
    print(f"Published to {topic}: {payload} (mid={getattr(info, 'mid', None)})")
    time.sleep(1)
    client.loop_stop()
    client.disconnect()

if __name__ == '__main__':
    publish_once()
