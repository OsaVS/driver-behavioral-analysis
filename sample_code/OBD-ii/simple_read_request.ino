#include <SPI.h>
#include <mcp2515.h>

struct can_frame canMsgSend;
struct can_frame canMsgRecv;
MCP2515 mcp2515(5);  // CS pin on GPIO5

void setup() {
  Serial.begin(115200);
  SPI.begin(18, 19, 23, 5);  // SCK, MISO, MOSI, CS
  
  mcp2515.reset();
  mcp2515.setBitrate(CAN_500KBPS, MCP_8MHZ);  // Adjust MCP_8MHZ if your module uses 16MHz
  mcp2515.setNormalMode();
  
  MCP2515::ERROR err = mcp2515.checkError();  // Changed from getError to checkError
  Serial.print("MCP2515 Error Register: ");
  Serial.println(err, HEX);
  if (err != MCP2515::ERROR_OK) {
    Serial.println("CAN init failed!");
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
    Serial.println(canMsgRecv.can_id, HEX);
  }
  
  // Request Engine RPM (PID 0x0C)
  sendPID(0x0C);
  readResponse();
  
  delay(2000);  // Wait 2 seconds
}

void sendPID(uint8_t pid) {
  canMsgSend.can_id = 0x7DF;
  canMsgSend.can_dlc = 8;
  canMsgSend.data[0] = 0x02;
  canMsgSend.data[1] = 0x01;
  canMsgSend.data[2] = pid;
  canMsgSend.data[3] = 0x00;
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
  unsigned long timeout = millis() + 500;
  while (millis() < timeout) {
    if (mcp2515.readMessage(&canMsgRecv) == MCP2515::ERROR_OK) {
      if (canMsgRecv.can_id == 0x7E8) {
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
