#include <SPI.h>
#include <mcp2515.h>

struct can_frame canMsgRecv;
MCP2515 mcp2515(5);  // CS pin on GPIO5

void setup() {
  Serial.begin(115200);
  SPI.begin(18, 19, 23, 5);  // SCK, MISO, MOSI, CS
  
  mcp2515.reset();
  mcp2515.setBitrate(CAN_500KBPS, MCP_8MHZ);  // Adjust to MCP_16MHZ if using a 16MHz crystal
  mcp2515.setNormalMode();
  
  // Check for initialization errors
  if (mcp2515.checkError()) {
    Serial.println("CAN init failed! Error flags detected.");
    uint8_t errorFlags = mcp2515.getErrorFlags();
    Serial.print("Error Flags: ");
    Serial.println(errorFlags, HEX);
    while (1);  // Halt if initialization fails
  } else {
    Serial.println("CAN init OK");
  }
  
  // Test SPI communication
  uint8_t status = mcp2515.getStatus();
  Serial.print("MCP2515 Status Register: ");
  Serial.println(status, HEX);
}

void loop() {
  // Monitor CAN bus for incoming messages
  if (mcp2515.readMessage(&canMsgRecv) == MCP2515::ERROR_OK) {
    Serial.print("Received CAN ID: ");
    Serial.print(canMsgRecv.can_id, HEX);
    Serial.print(", DLC: ");
    Serial.print(canMsgRecv.can_dlc);
    Serial.print(", Data: ");
    for (int i = 0; i < canMsgRecv.can_dlc; i++) {
      Serial.print(canMsgRecv.data[i], HEX);
      Serial.print(" ");
    }
    Serial.println();
  }
}