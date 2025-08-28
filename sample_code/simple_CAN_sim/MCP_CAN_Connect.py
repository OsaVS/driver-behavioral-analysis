from machine import Pin, SPI
import time

# MCP2515 commands
RESET = 0xC0
READ = 0x03
WRITE = 0x02
BIT_MODIFY = 0x05
READ_STATUS = 0xA0
RXB0SIDH = 0x61  # Start of RX buffer 0

# MCP2515 registers
CANCTRL = 0x0F
CANSTAT = 0x0E
CNF1 = 0x2A
CNF2 = 0x29
CNF3 = 0x28
RXB0CTRL = 0x60

class MCP2515:
    def __init__(self, spi, cs_pin):
        self.spi = spi
        self.cs = Pin(cs_pin, Pin.OUT)
        self.cs.high()
        self.reset()
        self.init_500kbps_8MHz()
        self.set_normal_mode()

    def _transfer(self, data):
        tx = bytearray(data)
        rx = bytearray(len(tx))
        self.cs.low()
        self.spi.write_readinto(tx, rx)
        self.cs.high()
        return rx

    def reset(self):
        self._transfer([RESET])
        time.sleep(0.1)

    def write_reg(self, addr, value):
        self._transfer([WRITE, addr, value])

    def read_reg(self, addr):
        resp = self._transfer([READ, addr, 0x00])
        return resp[2]

    def bit_modify(self, addr, mask, value):
        self._transfer([BIT_MODIFY, addr, mask, value])

    def init_500kbps_8MHz(self):
        # 500 kbps @ 8MHz crystal
        self.write_reg(CNF1, 0x01)
        self.write_reg(CNF2, 0xB1)
        self.write_reg(CNF3, 0x05)

    def set_normal_mode(self):
        self.write_reg(CANCTRL, 0x00)
        time.sleep(0.1)
        mode = self.read_reg(CANSTAT) & 0xE0
        if mode != 0x00:
            print("⚠️ Failed to enter Normal Mode, CANSTAT=0x{:02X}".format(mode))

    def check_message(self):
        # Read RX status
        status = self._transfer([READ_STATUS, 0x00])
        # Bit 0/1 indicate message in RXB0/RXB1
        return (status[1] & 0x01) != 0

    def receive(self):
        # Read RX buffer 0
        resp = self._transfer([READ, RXB0SIDH] + [0x00]*13)
        can_id = (resp[2] << 3) | (resp[3] >> 5)
        dlc = resp[6] & 0x0F
        data = resp[7:7+dlc]
        return can_id, dlc, data

# ----------------------------
# Main program
# ----------------------------
spi = SPI(0, baudrate=1000000, polarity=0, phase=0,
          sck=Pin(6), mosi=Pin(7), miso=Pin(4))
mcp = MCP2515(spi, cs_pin=5)

print("Pico W MCP2515 CAN Receiver Ready")

while True:
    if mcp.check_message():
        can_id, dlc, data = mcp.receive()
        print("Received CAN ID=0x{:03X}, DLC={}, Data={}".format(
            can_id, dlc, [hex(x) for x in data]))
    time.sleep(0.1)
