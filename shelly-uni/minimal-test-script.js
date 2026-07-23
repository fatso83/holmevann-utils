/**
 * Test that the physical button works and is enabling/disabling a potential free output relay
 *
 * Da vet vi at:
 * knappen fungerer
 * input fungerer
 * output fungerer
 * skript fungerer
 */
Shelly.addEventHandler(function (event) {
  if (
    event.component == "input:0" &&
    event.info &&
    event.info.event == "single_push"
  ) {
    let s = Shelly.getComponentStatus("switch:0");

    Shelly.call("Switch.Set", {
      id: 0,
      on: !s.output
    });
  }
});
