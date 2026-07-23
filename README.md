# holmevann-utils

Code and projects for anything related to the setup 
of holmevann that is not the [actual homepage](https://github.com/fatso83/holmevann).

This could be code or settings for 

# Shelly Uni

> Smart relay, capable of running on 9–30 VDC and switching two output relays.

The Shelly Plus Uni controls the Victron BatteryProtect/common 12 V bus and
the Phoenix inverter remote input. The paste-ready script is generated at
`dist/shelly-power-control.js`.

| Output | Shelly component | Purpose |
| --- | --- | --- |
| 12 V bus | `switch:0` | BatteryProtect and common 12 V loads |
| Inverter | `switch:1` | Phoenix inverter remote input |

The controller always enables 12 V before the inverter, and disables the
inverter before 12 V.

## Button controls

`input:0` must be configured as a detached momentary button. A short press is
resolved after a one-second double-press window; holding it for two seconds
enters TIMER mode.

| Current state | Single press | Double press | Two-second hold |
| --- | --- | --- | --- |
| TIMER/off | Manual 12 V | Manual full: 12 V + inverter | No-op |
| Manual 12 V | No-op | Manual full: 12 V + inverter | TIMER/off |
| Manual full | Manual 12 V | No-op | TIMER/off |

Manual states cancel and ignore all timer/poll callbacks. TIMER starts with
both outputs off, wakes the 12 V bus after 60 minutes, keeps it on for at least
10 minutes, and polls the remote endpoint every 60 seconds while the bus is on.
Only `KEEP_ON` extends a wake; `DEFAULT`, malformed responses, errors, and a
30-second request timeout allow normal shutdown.

## Development

Run the deterministic test suite and build the script:

```bash
npm test
npm run build
```

Paste `dist/shelly-power-control.js` into the Shelly Script editor.

# Teltonika RUT241 4G router
Responsible for 

- 4G network
- connecting to WireGuard VPN and exposing the cabin LAN to VPN
- exposing VPN hosts to the LAN so that they can do stuff like `GET api.holmevann.internal/power/batteryprotect`

Can be updated over the internet

# ESP32 sensor hub

Responsible for 
- collecting data from sensors (water level, diesel/kerosene level for Wallas burner, voltage, state-of-charge from SmartShunt)
- delivering data and config for the ReTerminal E1001 e-ink display (which is based on ESP32 too)

# ReTerminal E1001 E-Ink Display

Responsible for showing derived sensor data and status of the system from the ESP32, such as

remaining 
- water level in liters
- remaining diesel/kerosene for Walles in liters
- energy (through state-of-charge via the Victron SmartShunt) in kWh (SOC*(1-X% safety threshold for AGM)*total kWh in batteries)

consumption of 
- kerosene per day 
- water per day 
- energy per day 
compared to some reference usage and remaining days on that consumption


# Internal cloud-hosted API only accessible over VPN

- receive sensor data
- aggregate and compute derived data
- host external data/config (such as changing `DEFAULT` to `KEEP_ON` or enable heating cables)
