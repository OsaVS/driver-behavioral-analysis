#include <SPI.h>
#include <mcp2515.h>

struct can_frame canMsg;
struct MCP2515 mcp2515(5); // CS pin is GPIO 5

#define MAX_RETRIES 3
#define CAN_ACK_ID 0x037  // CAN ID for acknowledgment

int counter = 0; // Test data to send

void setup() {
  Serial.begin(115200);
  SPI.begin();
  mcp2515.reset();
  mcp2515.setBitrate(CAN_500KBPS, MCP_8MHZ);
  mcp2515.setNormalMode();
}

void loop() {
  // Prepare CAN message with test data
  canMsg.can_id  = 0x036;  // Example CAN ID
  canMsg.can_dlc = 2;      // Sending 2 bytes
  canMsg.data[0] = (counter >> 8) & 0xFF; // MSB
  canMsg.data[1] = counter & 0xFF;        // LSB

  bool messageSent = false;
  int retries = 0;

  while (!messageSent && retries < MAX_RETRIES) {
    if (mcp2515.sendMessage(&canMsg) == MCP2515::ERROR_OK) {
      Serial.print("Data sent: ");
      Serial.println(counter);

      // Wait for acknowledgment
      unsigned long startTime = millis();
      bool ackReceived = false;
      
      while (millis() - startTime < 500) { // Wait up to 500ms for an ACK
        if (mcp2515.readMessage(&canMsg) == MCP2515::ERROR_OK) {
          if (canMsg.can_id == CAN_ACK_ID) {
            ackReceived = true;
            break;
          }
        }
      }

      if (ackReceived) {
        Serial.println("ACK received");
        messageSent = true;
      } else {
        Serial.println("ACK not received, retrying...");
        retries++;
      }
    } else {
      Serial.println("Error sending message, retrying...");
      retries++;
    }
  }

  if (!messageSent) {
    Serial.println("Failed to send message after retries");
  }

  counter++; // Increment test data
  delay(1000); // Send data every second
}
