#include <WiFi.h>
#include <time.h>
#include <PubSubClient.h>

// Wi-Fi credentials
const char* ssid = "Redmi Note 10S"; // Replace with your Wi-Fi SSID
const char* password = "ovs101134"; // Replace with your Wi-Fi password

// NTP settings
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // IST: UTC+5:30
const int daylightOffset_sec = 0;

// CAN settings

// MQTT settings
const char* mqttServer = "192.168.41.188"; // Public MQTT broker
const int mqttPort = 1883;
const char* mqtt_client_id = "ESP32_Client";
const char* mqttTopic = "vehicle/vehicle123/data";

WiFiClient espClient;
PubSubClient mqttClient(espClient);


// Wi-Fi connection task
void WiFiTask(void *pvParameters) {
  while (1) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.print("Connecting to Wi-Fi...");
      WiFi.begin(ssid, password);
      while (WiFi.status() != WL_CONNECTED) {
        vTaskDelay(500 / portTICK_PERIOD_MS);
        Serial.print(".");
      }
      Serial.println("\nWiFi connected.");
    }
    vTaskDelay(5000 / portTICK_PERIOD_MS); // Check every 5 seconds
  }
}

// NTP synchronization task
void NTPTask(void *pvParameters) {
  unsigned long lastSyncTime = 0;
  const unsigned long syncInterval = 3600000; // 1 hour

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  time_t now = time(nullptr);
  while (now < 8 * 3600 * 2) {
    vTaskDelay(100 / portTICK_PERIOD_MS);
    now = time(nullptr);
  }
  Serial.println("Time synchronized.");

  while (1) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastSyncTime >= syncInterval || lastSyncTime == 0) {
      if (WiFi.status() == WL_CONNECTED) {
        configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
        now = time(nullptr);
        while (now < 8 * 3600 * 2) {
          vTaskDelay(100 / portTICK_PERIOD_MS);
          now = time(nullptr);
        }
        Serial.println("NTP resynchronized.");
        lastSyncTime = currentMillis;
      }
    }
    vTaskDelay(60000 / portTICK_PERIOD_MS); // Check every minute
  }
}

// OBD-II data retrieval task


// MQTT publishing task
void MQTTTask(void *pvParameters) {
  mqttClient.setServer(mqttServer, mqttPort);
  while (1) {
    if (!mqttClient.connected() && WiFi.status() == WL_CONNECTED) {
      Serial.print("Connecting to MQTT...");
      if (mqttClient.connect(mqtt_client_id)) {
        Serial.println("connected.");
      } else {
        Serial.println("failed.");
      }
    }

    if (mqttClient.connected()) {
      struct timeval tv;
      gettimeofday(&tv, nullptr);   // Get current time (seconds + microseconds)

      struct tm *timeinfo = localtime(&tv.tv_sec);  // Convert to human-readable format (year, month, day, hour...)

      int ms = tv.tv_usec / 1000;   // Convert microseconds → milliseconds

      char timestamp[30], fullTimestamp[35];
      strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", timeinfo);  
      // Format as "YYYY-MM-DD HH:MM:SS"

      snprintf(fullTimestamp, sizeof(fullTimestamp), "%s.%03d", timestamp, ms);
      // Append ".xxx" for milliseconds → "YYYY-MM-DD HH:MM:SS.mmm"

      char payload[100];
      snprintf(payload, sizeof(payload), "{\"timestamp\":\"%s\",\"ESP32\"}", fullTimestamp);
      mqttClient.publish(mqttTopic, payload);
      Serial.println("Published: " + String(payload));
    }

    mqttClient.loop(); // Process MQTT callbacks
    vTaskDelay(10000 / portTICK_PERIOD_MS); // Publish every second
  }
}

void setup() {
  Serial.begin(115200);

  // Create FreeRTOS tasks
  xTaskCreate(WiFiTask, "WiFiTask", 4096, NULL, 2, NULL);
  xTaskCreate(NTPTask, "NTPTask", 4096, NULL, 1, NULL);
  xTaskCreate(MQTTTask, "MQTTTask", 4096, NULL, 1, NULL);
}

void loop() {
  vTaskDelay(portMAX_DELAY); // Main loop does nothing
}