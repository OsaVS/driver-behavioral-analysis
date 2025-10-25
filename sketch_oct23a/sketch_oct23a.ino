#include <WiFi.h>
#include <time.h>
#include <PubSubClient.h>
#include <WiFiManager.h>

// CAN includes (RPM requester task)
#include <SPI.h>
#include <mcp_can.h>

// CAN pinout (ESP32 wiring used elsewhere in workspace)
const int SPI_CS_PIN = 5;
const int CAN_INT_PIN = 4;
MCP_CAN CAN0(SPI_CS_PIN);

// MQTT mutex to protect PubSubClient calls from multiple tasks
SemaphoreHandle_t mqttMutex = NULL;

// RPM request parameters
const unsigned long rpmRequestIntervalMs = 1000; // request every 1s
const unsigned long rpmResponseTimeoutMs = 300;  // ms to wait for ECU reply
byte rpmRequest[8] = {0x02, 0x01, 0x0C, 0x00, 0x00, 0x00, 0x00, 0x00};

inline bool isAcceptedStdId(unsigned long id) { return id >= 0x7E8 && id <= 0x7EF; }

// Forward declaration
void RPMTask(void *pvParameters);

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // IST: UTC+5:30
const int daylightOffset_sec = 0;

const char* mqttServer = "192.168.1.12";
// const char* mqttServer = "10.179.74.188";
const int mqttPort = 1883;
const char* mqtt_client_id = "ESP32_Client";
const char* mqttTopic = "devices/X-1050/telemetry";

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
  // Initialize CAN controller (try 500kbps then 250kbps)
  SPI.begin(18, 19, 23, SPI_CS_PIN);
  if (CAN0.begin(MCP_ANY, CAN_500KBPS, MCP_8MHZ) == CAN_OK) {
    Serial.println("[CAN] MCP2515 init: 500 kbps");
  } else if (CAN0.begin(MCP_ANY, CAN_250KBPS, MCP_8MHZ) == CAN_OK) {
    Serial.println("[CAN] MCP2515 init: 250 kbps");
  } else {
    Serial.println("[CAN] MCP2515 init failed - check wiring/Vcc/crystal");
    // continue without reboot; RPMTask will fail to send if CAN not present
  }
  CAN0.setMode(MCP_NORMAL);
  pinMode(CAN_INT_PIN, INPUT);

  // Create mutex for MQTT client
  mqttMutex = xSemaphoreCreateMutex();

  xTaskCreate(WiFiTask, "WiFiTask", 4096, NULL, 2, NULL);
  xTaskCreate(NTPTask, "NTPTask", 4096, NULL, 1, NULL);
  xTaskCreate(MQTTTask, "MQTTTask", 4096, NULL, 1, NULL);
  // Start RPM requester task
  xTaskCreate(RPMTask, "RPMTask", 4096, NULL, 2, NULL);
}

void loop() {
  vTaskDelay(portMAX_DELAY); // Main loop does nothing
}

// Sensor requester task: requests speed, RPM, throttle position, engine load
// every rpmRequestIntervalMs (default 1000 ms) and publishes aggregated JSON
void RPMTask(void *pvParameters) {
  (void)pvParameters;

  // OBD request frames for each PID
  byte speedReq[8]    = {0x02, 0x01, 0x0D, 0x00,0x00,0x00,0x00,0x00}; // speed
  byte rpmReq[8]      = {0x02, 0x01, 0x0C, 0x00,0x00,0x00,0x00,0x00}; // rpm
  byte throttleReq[8] = {0x02, 0x01, 0x11, 0x00,0x00,0x00,0x00,0x00}; // throttle pos
  byte loadReq[8]     = {0x02, 0x01, 0x04, 0x00,0x00,0x00,0x00,0x00}; // engine load

  const unsigned long interSendMs = 50; // small gap between requests

  unsigned long lastCycle = 0;
  for (;;) {
    unsigned long now = millis();
    if (now - lastCycle >= rpmRequestIntervalMs) {
      lastCycle = now;

      float speed = -1.0f;
      float rpm = -1.0f;
      float throttle = -1.0f;
      float engLoad = -1.0f;

      // helper lambda to send a request and wait for a matching response
      auto requestAndRead = [&](byte *req, uint8_t expectedPid, float &outVal)->bool {
        int rc = CAN0.sendMsgBuf(0x7DF, 0, 8, req);
        if (rc != CAN_OK) {
          Serial.print("[SENSOR] Send failed for PID "); Serial.println(expectedPid, HEX);
          return false;
        }
        unsigned long start = millis();
        while (millis() - start < rpmResponseTimeoutMs) {
          if (!digitalRead(CAN_INT_PIN)) {
            unsigned long rxId; unsigned char dlc; unsigned char buf[8];
            if (CAN0.readMsgBuf(&rxId, &dlc, buf) == CAN_OK) {
              unsigned long stdId = rxId & 0x7FF;
              if (!isAcceptedStdId(stdId)) continue;
              // single-frame OBD response pattern: [len, 0x41, PID, ...]
              if (dlc >= 3 && buf[1] == 0x41 && buf[2] == expectedPid) {
                // parse according to PID
                if (expectedPid == 0x0D && dlc >= 4) { // speed
                  outVal = buf[3];
                  return true;
                } else if (expectedPid == 0x0C && dlc >= 5) { // rpm
                  unsigned int A = buf[3]; unsigned int B = buf[4];
                  outVal = ((A * 256UL) + B) / 4.0;
                  return true;
                } else if (expectedPid == 0x11 && dlc >= 4) { // throttle
                  outVal = (buf[3] * 100.0) / 255.0;
                  return true;
                } else if (expectedPid == 0x04 && dlc >= 4) { // engine load
                  outVal = (buf[3] * 100.0) / 255.0;
                  return true;
                }
              }
            }
          }
          vTaskDelay(5 / portTICK_PERIOD_MS);
        }
        return false;
      };

      // Request speed
      requestAndRead(speedReq, 0x0D, speed);
      vTaskDelay(interSendMs / portTICK_PERIOD_MS);
      // Request RPM
      requestAndRead(rpmReq, 0x0C, rpm);
      vTaskDelay(interSendMs / portTICK_PERIOD_MS);
      // Request throttle
      requestAndRead(throttleReq, 0x11, throttle);
      vTaskDelay(interSendMs / portTICK_PERIOD_MS);
      // Request engine load
      requestAndRead(loadReq, 0x04, engLoad);

      // Build timestamp with ms
      struct timeval tv; gettimeofday(&tv, nullptr);
      double ts = tv.tv_sec + tv.tv_usec / 1e6;

      // Build JSON payload exactly as requested
      // vehicle_id: ABC123 (fixed here), timestamp as seconds.milliseconds
      char payload[200];
      int n = snprintf(payload, sizeof(payload),
        "{\"vehicle_id\":\"ABC123\",\"timestamp\":%.3f,\"speed\":%.1f,\"engine_rpm\":%d,\"engine_load\":%.1f,\"throttle_pos\":%.1f}",
        ts,
        (speed < 0) ? 0.0 : speed,
        (int)((rpm < 0) ? 0 : round(rpm)),
        (engLoad < 0) ? 0.0 : engLoad,
        (throttle < 0) ? 0.0 : throttle
      );

      // Print locally
      Serial.print("[SENSOR] Payload: "); Serial.println(payload);

      // Publish using mqttMutex
      if (mqttClient.connected() && mqttMutex != NULL) {
        if (xSemaphoreTake(mqttMutex, (TickType_t)200 / portTICK_PERIOD_MS) == pdTRUE) {
          mqttClient.publish(mqttTopic, payload);
          xSemaphoreGive(mqttMutex);
        }
      }
    }
    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
}