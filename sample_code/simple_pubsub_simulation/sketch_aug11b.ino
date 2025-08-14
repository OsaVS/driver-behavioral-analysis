
#include <WiFi.h>
#include <PubSubClient.h>

// WiFi credentials (replace with your own)
const char* ssid = "Redmi Note 10S";       // Replace with your Wi-Fi SSID
const char* password = "ovs101134"; 

// MQTT broker details (replace with your own, e.g., broker.hivemq.com for testing)
const char* mqtt_server = "192.168.41.188";
const int mqtt_port = 1883; // Default MQTT port

// Vehicle ID for MQTT topic structure
const char* vehicleID = "vehicle123"; // Replace with your vehicle ID

// MQTT client setup
WiFiClient espClient;
PubSubClient client(espClient);

// Reconnect to MQTT if connection is lost
void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Attempt to connect (use a unique client ID)
    if (client.connect("ESP32_OBD_Client")) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200); // USB UART for communication with Python script/OBD simulator
  Serial.println("ESP32 OBD-II Receiver Ready");

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  // Set MQTT server
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop(); // Handle MQTT client tasks

  // Read incoming data from UART (simulated OBD-II stream)
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim(); // Clean up any extra whitespace
    Serial.print("Received: ");
    Serial.println(line);

    // Parse the line (assuming format like "SPEED:50" or "RPM:2000")
    int colonIndex = line.indexOf(':');
    if (colonIndex != -1) {
      String parameter = line.substring(0, colonIndex);
      parameter.toLowerCase();
      String value = line.substring(colonIndex + 1);
      // Construct MQTT topic in the format "vehicleID/parameter"
      String topic = String(vehicleID) + "/" + parameter;
      // Publish to MQTT topic
      if (client.publish(topic.c_str(), value.c_str())) {
        Serial.print("Published to ");
        Serial.print(topic);
        Serial.println(": " + value);
      } else {
        Serial.println("Failed to publish to MQTT");
      }
    } else {
      // Fallback: publish to a generic topic if format is unexpected
      String topic = String(vehicleID) + "/raw";
      if (client.publish(topic.c_str(), line.c_str())) {
        Serial.print("Published to ");
        Serial.print(topic);
        Serial.println(": " + line);
      } else {
        Serial.println("Failed to publish to MQTT");
      }
    }
  }
}