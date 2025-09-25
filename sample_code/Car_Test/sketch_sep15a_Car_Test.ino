#include <SPI.h>
#include <mcp2515.h>

struct can_frame canMsgSend;
struct can_frame canMsgRecv;
MCP2515 mcp2515(5);  // CS pin on GPIO5

void setup() {
  Serial.begin(115200);
  SPI.begin(18, 19, 23, 5);  // SCK, MISO, MOSI, CS
  
  mcp2515.reset();
  mcp2515.setBitrate(CAN_500KBPS, MCP_8MHZ);  // Adjust to MCP_16MHZ if your module uses a 16MHz crystal
  mcp2515.setNormalMode();
  
  // Check for errors using checkError()
  if (mcp2515.checkError()) {  // Returns true if errors exist
    Serial.println("CAN init failed! Error flags detected.");
    uint8_t errorFlags = mcp2515.getErrorFlags();  // Optional: Read specific error flags
    Serial.print("Error Flags: ");
    Serial.println(errorFlags, HEX);
    while (1);
  } else {
    Serial.println("CAN init OK");
  }
  
  // Test SPI communication
  uint8_t status = mcp2515.getStatus();
  Serial.print("MCP2515 Status Register: ");
  Serial.println(status, HEX);
}

void loop() {
  // Monitor CAN bus for any messages
  if (mcp2515.readMessage(&canMsgRecv) == MCP2515::ERROR_OK) {
    Serial.print("Received CAN ID: ");
    Serial.println(canMsgRecv.can_id, HEX);
  }
  
  // Request Engine RPM (PID 0x0C)
  sendPID(0x0C);
  readResponse();
  
  delay(2000);  // Wait 2 seconds
}

void sendPID(uint8_t pid) {
  canMsgSend.can_id = 0x7DF;  // Standard OBD-II request ID
  canMsgSend.can_dlc = 8;     // Data length code
  canMsgSend.data[0] = 0x02;  // Number of data bytes
  canMsgSend.data[1] = 0x01;  // Mode 01 (current data)
  canMsgSend.data[2] = pid;   // PID (e.g., 0x0C for RPM)
  canMsgSend.data[3] = 0x00;  // Padding
  canMsgSend.data[4] = 0x00;
  canMsgSend.data[5] = 0x00;
  canMsgSend.data[6] = 0x00;
  canMsgSend.data[7] = 0x00;
  
  MCP2515::ERROR err = mcp2515.sendMessage(&canMsgSend);
  if (err != MCP2515::ERROR_OK) {
    Serial.print("Send failed with error code: ");
    Serial.println(err, HEX);
  } else {
    Serial.println("PID request sent");
  }
}

void readResponse() {
  unsigned long timeout = millis() + 500;  // 500ms timeout
  while (millis() < timeout) {
    if (mcp2515.readMessage(&canMsgRecv) == MCP2515::ERROR_OK) {
      if (canMsgRecv.can_id == 0x7E8) {  // Standard OBD-II response ID
        uint8_t pid = canMsgRecv.data[2];
        if (pid == 0x0C) {  // RPM
          uint16_t rpm = ((canMsgRecv.data[3] * 256) + canMsgRecv.data[4]) / 4;
          Serial.print("RPM: ");
          Serial.println(rpm);
        }
      }
    }
  }
}