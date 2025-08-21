#include <WiFi.h>
#include <time.h>
#include <ESP32CAN.h>
#include <CAN_config.h>
#include <OBD2.h>
#include <PubSubClient.h>

// Wi-Fi credentials
const char* ssid = "your-SSID"; // Replace with your Wi-Fi SSID
const char* password = "your-PASSWORD"; // Replace with your Wi-Fi password

// NTP settings
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // IST: UTC+5:30
const int daylightOffset_sec = 0;

// CAN settings
CAN_device_t CAN_cfg;
const int rx_pin = 4; // GPIO for CAN RX
const int tx_pin = 5; // GPIO for CAN TX

// MQTT settings
const char* mqttServer = "broker.hivemq.com"; // Public MQTT broker
const int mqttPort = 1883;
const char* mqttClientId = "ESP32_OBD_Client";
const char* mqttTopic = "vehicle/obd/data";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Shared queue for OBD data
QueueHandle_t obdQueue;

// Structure for OBD data
struct OBDData {
  float rpm;
  float speed;
  char timestamp[35];
};

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
void OBDTask(void *pvParameters) {
  const unsigned long readInterval = 100; // 100ms

  while (1) {
    unsigned long currentMillis = millis();
    if (currentMillis - ulTaskGetRunTimeCounter() >= readInterval) {
      struct timeval tv;
      gettimeofday(&tv, nullptr);
      struct tm *timeinfo = localtime(&tv.tv_sec);
      int ms = tv.tv_usec / 1000;
      char timestamp[30], fullTimestamp[35];
      strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", timeinfo);
      snprintf(fullTimestamp, sizeof(fullTimestamp), "%s.%03d", timestamp, ms);

      OBDData data;
      data.rpm = OBD2.pidRead(PID_ENGINE_RPM);
      data.speed = OBD2.pidRead(PID_VEHICLE_SPEED);
      strncpy(data.timestamp, fullTimestamp, sizeof(data.timestamp));

      xQueueSend(obdQueue, &data, portMAX_DELAY);
      vTaskDelay(readInterval / portTICK_PERIOD_MS);
    }
  }
}

// MQTT publishing task
void MQTTTask(void *pvParameters) {
  mqttClient.setServer(mqttServer, mqttPort);
  while (1) {
    if (!mqttClient.connected() && WiFi.status() == WL_CONNECTED) {
      Serial.print("Connecting to MQTT...");
      if (mqttClient.connect(mqttClientId)) {
        Serial.println("connected.");
      } else {
        Serial.println("failed.");
      }
    }

    if (mqttClient.connected()) {
      OBDData data;
      if (xQueueReceive(obdQueue, &data, 1000 / portTICK_PERIOD_MS)) {
        char payload[100];
        snprintf(payload, sizeof(payload), "{\"timestamp\":\"%s\",\"rpm\":%.0f,\"speed\":%.0f}",
                 data.timestamp, isnan(data.rpm) ? -1 : data.rpm, isnan(data.speed) ? -1 : data.speed);
        mqttClient.publish(mqttTopic, payload);
        Serial.println(payload); // For debugging
      }
    }
    mqttClient.loop(); // Process MQTT callbacks
    vTaskDelay(1000 / portTICK_PERIOD_MS); // Publish every second
  }
}

void setup() {
  Serial.begin(115200);

  // Initialize CAN
  CAN_cfg.speed = CAN_SPEED_500KBPS;
  CAN_cfg.tx_pin_id = (gpio_num_t)tx_pin;
  CAN_cfg.rx_pin_id = (gpio_num_t)rx_pin;
  CAN_cfg.rx_queue = xQueueCreate(10, sizeof(CAN_frame_t));
  if (ESP32Can.CANInit() != 0) {
    Serial.println("CAN Init Failed!");
    while (1);
  }
  OBD2.begin();
  Serial.println("OBD2 Initialized.");

  // Create OBD data queue
  obdQueue = xQueueCreate(10, sizeof(OBDData));

  // Create FreeRTOS tasks
  xTaskCreate(WiFiTask, "WiFiTask", 4096, NULL, 2, NULL);
  xTaskCreate(NTPTask, "NTPTask", 4096, NULL, 1, NULL);
  xTaskCreate(OBDTask, "OBDTask", 4096, NULL, 3, NULL);
  xTaskCreate(MQTTTask, "MQTTTask", 4096, NULL, 1, NULL);
}

void loop() {
  vTaskDelay(portMAX_DELAY); // Main loop does nothing
}