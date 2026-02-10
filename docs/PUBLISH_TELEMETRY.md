# IoT Device Setup Guide

This guide walks you through publishing telemetry messages to the system to test.

### Using AWS IoT Console (Testing)
1. Go to AWS IoT Core Console
2. Navigate to **Test** > **MQTT test client**
3. Click **Publish to a topic**
4. Enter topic: `telemetry/charger-device-001`
5. Enter message payload:
```json
{
  "chargerId": "charger-device-001",
  "timestamp": "2026-02-10T19:58:24.656Z",
  "data": {
    "voltage": 240.5,
    "current": 32.0
  }
}
```
6. Click **Publish**

