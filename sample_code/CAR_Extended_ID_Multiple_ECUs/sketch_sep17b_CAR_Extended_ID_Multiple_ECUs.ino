#include <SPI.h>
#include <mcp2515.h>

struct can_frame canMsgSend;
struct can_frame canMsgRecv;
MCP2515 mcp2515(5);  // CS pin on GPIO5

void setup() {
  Serial.begin(115200);
  SPI.begin(18, 19, 23, 5);  // SCK, MISO, MOSI, CS
  
  mcp2515.reset();
  mcp2515.setBitrate(CAN_500KBPS, MCP_8MHZ);  // Adjust to MCP_16MHZ if using a 16MHz crystal
  // Set filters to accept 0x18DAF110 to 0x18DAF1FF
  mcp2515.setFilterMask(MCP2515::MASK0, true, 0x1FFFFF00);  // Match 0x18DAF1XX (mask last 8 bits)
  mcp2515.setFilter(MCP2515::RXF0, true, 0x18DAF110);       // Accept 0x18DAF110
  mcp2515.setFilter(MCP2515::RXF1, true, 0x18DAF111);       // Accept 0x18DAF111
  mcp2515.setFilter(MCP2515::RXF2, true, 0x18DAF112);       // Accept 0x18DAF112
  mcp2515.setFilter(MCP2515::RXF3, true, 0x18DAF113);       // Accept 0x18DAF113
  mcp2515.setFilter(MCP2515::RXF4, true, 0x18DAF114);       // Accept 0x18DAF114
  mcp2515.setFilter(MCP2515::RXF5, true, 0x18DAF115);       // Accept 0x18DAF115
  mcp2515.setNormalMode();
  
  // Check for errors
  bool err = mcp2515.checkError();  // checkError returns bool
  Serial.print("MCP2515 Error Check: ");
  Serial.println(err ? "Errors detected" : "No errors");
  if (err) {
    Serial.println("CAN init failed!");
    uint8_t errorFlags = mcp2515.getErrorFlags();
    Serial.print("Error Flags: ");
    Serial.println(errorFlags, HEX);
    while (1);
  }
  Serial.println("CAN init OK");
  
  // Test SPI communication
  uint8_t status = mcp2515.getStatus();
  Serial.print("MCP2515 Status Register: ");
  Serial.println(status, HEX);
}

void loop() {
  // Monitor CAN bus for any messages
  if (mcp2515.readMessage(&canMsgRecv) == MCP2515::ERROR_OK) {
    Serial.print("Received CAN ID: ");
    Serial.print(canMsgRecv.can_id, HEX);
    if (canMsgRecv.can_id & CAN_EFF_FLAG) Serial.print(" (Extended)");
    Serial.print(", DLC: ");
    Serial.print(canMsgRecv.can_dlc);
    Serial.print(", Data: ");
    for (int i = 0; i < canMsgRecv.can_dlc; i++) {
      Serial.print(canMsgRecv.data[i], HEX);
      Serial.print(" ");
    }
    Serial.println();
  }
  
  // Request Engine RPM (PID 0x0C)
  sendPID(0x0C);
  readResponse();
  
  delay(2000);  // Wait 2 seconds
}

void sendPID(uint8_t pid) {
  canMsgSend.can_id = 0x18DB33F1 | CAN_EFF_FLAG;  // Extended OBD-II request ID
  canMsgSend.can_dlc = 8;                         // Data length code
  canMsgSend.data[0] = 0x02;                      // Number of data bytes
  canMsgSend.data[1] = 0x01;                      // Mode 01 (current data)
  canMsgSend.data[2] = pid;                       // PID (e.g., 0x0C for RPM)
  canMsgSend.data[3] = 0x00;                      // Padding
  canMsgSend.data[4] = 0x00;
  canMsgSend.data[5] = 0x00;
  canMsgSend.data[6] = 0x00;
  canMsgSend.data[7] = 0x00;
  
  MCP2515::ERROR err = mcp2515.sendMessage(&canMsgSend);
  if (err != MCP2515::ERROR_OK) {
    Serial.print("Send failed with error code: ");
    Serial.println(err, HEX);
    uint8_t errorFlags = mcp2515.getErrorFlags();
    Serial.print("Error Flags: ");
    Serial.println(errorFlags, HEX);
    delay(100);  // Prevent buffer overflow
  } else {
    Serial.println("PID request sent");
  }
}

void readResponse() {
  unsigned long timeout = millis() + 1000;  // 1-second timeout
  while (millis() < timeout) {
    if (mcp2515.readMessage(&canMsgRecv) == MCP2515::ERROR_OK) {
      unsigned long base_id = canMsgRecv.can_id & 0x1FFFFFFF;  // Mask to get 29-bit ID
      if (base_id >= 0x18DAF110 && base_id <= 0x18DAF1FF) {  // Accept OBD-II response IDs
        uint8_t pid = canMsgRecv.data[2];
        if (pid == 0x0C) {  // RPM
          uint16_t rpm = ((canMsgRecv.data[3] * 256) + canMsgRecv.data[4]) / 4;
          Serial.print("RPM from ID ");
          Serial.print(canMsgRecv.can_id, HEX);
          Serial.print(": ");
          Serial.println(rpm);
        } else if (canMsgRecv.data[1] == 0x7F) {  // Negative response
          Serial.print("Negative response from ID ");
          Serial.print(canMsgRecv.can_id, HEX);
          Serial.print(", error code: ");
          Serial.println(canMsgRecv.data[3], HEX);
        }
      }
    }
  }
}