#include <WiFi.h>
#include <PubSubClient.h>

// WiFi credentials
const char* ssid = "Redmi Note 10S";       // Replace with your Wi-Fi SSID
const char* password = "ovs101134"; // Replace with your Wi-Fi password

// MQTT Broker settings
const char* mqtt_server = "192.168.41.188"; // e.g., "192.168.0.26" for local or "test.mosquitto.org" for online
const int mqtt_port = 1883;
const char* mqtt_client_id = "ESP32_Client"; // Unique client ID
const char* mqtt_topic = "test/topic"; // Topic to publish/subscribe

WiFiClient espClient;
PubSubClient client(espClient);

void setup_wifi() {
  delay(10);
  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message received on topic: ");
  Serial.println(topic);
  Serial.print("Message: ");
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println(message);
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect(mqtt_client_id)) {
      Serial.println("connected");
      client.subscribe(mqtt_topic); // Subscribe to topic
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  // Publish a message every 5 seconds
  static unsigned long lastMsg = 0;
  unsigned long now = millis();
  if (now - lastMsg > 5000) {
    lastMsg = now;
    String message = "Hello from ESP32";
    client.publish(mqtt_topic, message.c_str());
    Serial.println("Published: " + message);
  }
}