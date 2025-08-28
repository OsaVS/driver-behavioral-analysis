#include <WiFi.h>
#include <time.h>

// Wi-Fi credentials
const char* ssid = "Redmi Note 10S"; // Replace with your Wi-Fi SSIDs
const char* password = "ovs101134"; // Replace with your Wi-Fi password

// NTP server settings
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // IST: UTC+5:30
const int daylightOffset_sec = 0; // No daylight saving

void setup() {
  Serial.begin(115200);

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected.");

  // Initialize NTP
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  time_t now = time(nullptr);
  while (now < 8 * 3600 * 2) { // Wait for valid time
    delay(100);
    now = time(nullptr);
  }
  Serial.println("Time synchronized.");
}

void loop() {
  // Get current time with ms precision
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  struct tm *timeinfo = localtime(&tv.tv_sec);
  int ms = tv.tv_usec / 1000;

  // Format and print timestamp
  char timestamp[30];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", timeinfo);
  Serial.printf("%s.%03d\n", timestamp, ms);

  delay(1000); // Update every second
}