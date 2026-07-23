# Shelly Plus Uni power control

This project controls the 12 V BatteryProtect/load bus and the inverter remote
input on a Shelly Plus Uni. The generated deployment script is
`dist/shelly-power-control.js`.

| Output | Shelly component | Purpose |
| --- | --- | --- |
| 12 V bus | `switch:0` | BatteryProtect and common 12 V loads |
| Inverter | `switch:1` | Phoenix inverter remote input |

The controller always enables 12 V before the inverter and disables the
inverter before 12 V.

## Button controls

Configure `input:0` as a detached momentary button. A short press is resolved
after a one-second double-press window; holding the button for two seconds
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

```bash
npm test
npm run build
```

Paste `dist/shelly-power-control.js` into the Shelly Script editor.
