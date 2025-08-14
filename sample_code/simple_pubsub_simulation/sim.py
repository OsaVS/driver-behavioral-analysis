import serial
import time
import random

# Serial port configuration
SERIAL_PORT = 'COM3'  # Replace with your ESP32's COM port (e.g., 'COM3', 'COM5')
BAUD_RATE = 115200    # Must match ESP32's Serial.begin(115200)

def main():
    try:
        # Initialize serial connection
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"Connected to {SERIAL_PORT} at {BAUD_RATE} baud")
        time.sleep(2)  # Wait for ESP32 to initialize

        print("Simulating OBD-II data stream...")
        while True:
            # Generate fake OBD-II style data (e.g., "SPEED:50\nRPM:2000\n")
            speed = random.randint(0, 120)
            rpm = random.randint(0, 6000)
            data_lines = [
                f"SPEED:{speed}\n",
                f"RPM:{rpm}\n",
                f"TEMP:{random.randint(80, 100)}\n"
            ]

            # Send each line over UART
            for line in data_lines:
                ser.write(line.encode('utf-8'))
                print(f"Sent: {line.strip()}")
                time.sleep(1)  # Delay between lines to simulate real-time data

    except serial.SerialException as e:
        print(f"Serial error: {e}")
    except KeyboardInterrupt:
        print("\nStopping simulation")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()
            print("Serial port closed")

if __name__ == "__main__":
    main()