# OBD-II Port

## Introduction
The On-Board Diagnostic II (OBD-II) port is a standardized interface in vehicles (post-1996) that provides access to diagnostic and real-time data from the car's internal systems. It helps monitor vehicle health, emisions and performance.
2008: US cars must use ISO 15765-4 (CAN) as OBD2 basis. 
The OBD2 standard was recommended by the Society of Automotive Engineers (SAE) and standardized DTCs and the OBD connector across manufacturers (SAE J1962).

## Port Interface

<img width="335" height="120" alt="image" src="https://github.com/user-attachments/assets/f2b44b99-18f6-4559-a3c2-6e958ef494ed" />

<img width="435" height="474" alt="image" src="https://github.com/user-attachments/assets/0c333709-f194-4234-a702-acfa8da875e9" />

- 9  measuring modes to access data
- Mode 01 can be used to access real-time data such as Engine RPM, speed , fuel levels.

## How data is retrieved 
1. Connect scanner to the OBD-II port. (Adaptor based on ELM327)
2. Initialze communication
3. Send requests
4. Decode responses

