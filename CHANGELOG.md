# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- PETLIBRO account (e-mail and password): the token is kept across restarts. A
  sign-in refused, an unknown e-mail, or a token refused because the PETLIBRO
  app signed in with the same account are reported without signing in again
  and again (at most one sign-in every 15 minutes); the guide explains the
  second account to share the devices with.
- One device per dry food feeder (Granary, Granary Camera, Air, One RFID,
  Space): "Feed now" button (portions set in the configuration), "Feeding
  plan" switch, food level (per hopper on the two-hopper Granary), portions
  dispensed today, meals today, last meal, desiccant (percent of its cycle,
  days left, "Desiccant replaced" button), battery, battery low, mains power,
  online state.
- One device per Polar wet food feeder: food level, temperature, cleaning
  (percent, days left, "Cleaned" button), battery, online state.
- One device per Dockstream fountain: "Pump" switch (Dockstream 2), water
  level against its low-water threshold, water level %, water left and drunk
  today in mL, drinks today, filter and cleaning (percent, days left, reset
  buttons), battery, charging and mains power (Cordless), error, online state.
- The scene action "Feed with a PETLIBRO feeder" (1 to 48 portions, 16 on the
  Air) and the scene triggers "Meal dispensed" (portions) and "PETLIBRO alert"
  (food low, water low, battery low, desiccant or filter to replace, cleaning
  due, device error).
- "Test the connection" button with the list of the devices.
- Feature names and alert messages in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-petlibro/commits/main
