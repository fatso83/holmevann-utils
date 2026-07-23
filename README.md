# holmevann-utils

Code and projects for anything related to the setup 
of holmevann that is not the [actual homepage](https://github.com/fatso83/holmevann).

This could be code or settings for 

# Shelly Uni
> smart relay, capable of running on 9-30 VDC and switching two output relays

Responsible for 

- handle button clicks 
- turning on/off the Victron BatteryProtect for 12V consumers (BP)
- turning on/off the Victron Phoenix 220V AC inverter (*)
- power cycling the BP: every 2 hours it stays on for 10 minutes between 8 and 22
- checking an API to see if it should stay on

* this also has an interlock relay to the 12V to make sure that turning off 12V consumers will also turn off the inverter 

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
