import paho.mqtt.client as mqtt

BROKER = "localhost"
PORT = 1883


def on_connect(client, userdata, flags, rc):
    print("Watcher connected with rc=", rc)
    client.subscribe('#')


def on_message(client, userdata, msg):
    print(f"WATCHER RECEIVED on {msg.topic}: {msg.payload.decode()}")


client = mqtt.Client(client_id="watcher")
client.on_connect = on_connect
client.on_message = on_message

client.connect(BROKER, PORT, 60)
client.loop_start()

try:
    print("Watcher running - press Ctrl+C to stop")
    import time
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Watcher stopping")
finally:
    client.loop_stop()
    client.disconnect()
