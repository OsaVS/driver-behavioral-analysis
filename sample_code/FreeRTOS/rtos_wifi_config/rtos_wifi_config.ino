#include <WiFi.h>
#include <time.h>
#include <PubSubClient.h>
#include <WiFiManager.h>

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // IST: UTC+5:30
const int daylightOffset_sec = 0;

const char* mqttServer = "192.168.41.188";
const int mqttPort = 1883;
const char* mqtt_client_id = "ESP32_Client";
const char* mqttTopic = "vehicle/vehicle123/data";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

void WiFiTask(void *pvParameters) {
  unsigned long lastAttemptTime = 0;
  const unsigned long reconnectTimeout = 30000; // 30 seconds timeout for reconnection attempts

  while (1) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi not connected, attempting to reconnect...");
      WiFi.reconnect();
      
      // Wait for reconnection attempt
      unsigned long startAttempt = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < reconnectTimeout) {
        vTaskDelay(500 / portTICK_PERIOD_MS);
      }

      // If still not connected, start WiFiManager configuration portal
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Reconnection failed, starting WiFiManager configuration portal...");
        WiFiManager wifiManager;
        wifiManager.setTimeout(180); // 3-minute timeout
        if (!wifiManager.startConfigPortal("ESP32_Config_AP")) {
          Serial.println("Failed to connect via configuration portal, restarting...");
          ESP.restart();
        }
        Serial.println("WiFi connected via configuration portal.");
        Serial.print("IP address: ");
        Serial.println(WiFi.localIP());
      }
    }
    vTaskDelay(5000 / portTICK_PERIOD_MS); // Check every 5 seconds
  }
}

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
      gettimeofday(&tv, nullptr);
      struct tm *timeinfo = localtime(&tv.tv_sec);
      int ms = tv.tv_usec / 1000;

      char timestamp[30], fullTimestamp[35];
      strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", timeinfo);
      snprintf(fullTimestamp, sizeof(fullTimestamp), "%s.%03d", timestamp, ms);

      char payload[100];
      snprintf(payload, sizeof(payload), "{\"timestamp\":\"%s\",\"ESP32\"}", fullTimestamp);
      mqttClient.publish(mqttTopic, payload);
      Serial.println("Published: " + String(payload));
    }

    mqttClient.loop();
    vTaskDelay(10000 / portTICK_PERIOD_MS); // Publish every 10 seconds
  }
}

void setup() {
  Serial.begin(115200);

  WiFiManager wifiManager;
  wifiManager.resetSettings(); // Uncomment to reset saved Wi-Fi credentials
  wifiManager.setTimeout(180); // 3-minute timeout

  if (!wifiManager.autoConnect("ESP32_Config_AP")) {
    Serial.println("Failed to connect and hit timeout");
    ESP.restart();
  }

  Serial.println("WiFi connected.");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  xTaskCreate(WiFiTask, "WiFiTask", 4096, NULL, 2, NULL);
  xTaskCreate(NTPTask, "NTPTask", 4096, NULL, 1, NULL);
  xTaskCreate(MQTTTask, "MQTTTask", 4096, NULL, 1, NULL);
}

void loop() {
  vTaskDelay(portMAX_DELAY); // Main loop does nothing
}