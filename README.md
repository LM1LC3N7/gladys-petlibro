# gladys-petlibro

[Gladys Assistant](https://gladysassistant.com) external integration for
**PETLIBRO**: Granary, Air, One RFID, Space and Polar feeders and Dockstream
water fountains, through the PETLIBRO cloud (the one of the app). Food level,
meals of the day and last meal, feeding plan, desiccant, water level and
water left, pump, drinks, filter and cleaning of the fountains, batteries and
online states; a feed button, feeding plan and pump switches, reset buttons
for the consumables, a "Feed" scene action, and scene triggers when a meal is
dispensed or an alert starts. Unofficial, not affiliated with PETLIBRO.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (0.1, not published to the store yet).** Tested with
> simulated answers, not yet with a real PETLIBRO account. Feedback and bug
> reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-petlibro/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (PetlibroApp) ⇄ src/client.js ⇄ src/petlibro.js ⇄ api.us.petlibro.com
                                 ├─ src/inventory.js  PETLIBRO answers -> devices, meals (pure)
                                 ├─ src/devices.js    -> Gladys devices and states (pure)
                                 ├─ src/events.js     two readings -> scene events (pure)
                                 ├─ src/publisher.js  300 states/min, dated states and scene events queued
                                 └─ src/store.js      token and last sign-in (/data)
```

- **Account**: e-mail and password (`secret` field) of a PETLIBRO account.
  `POST /member/auth/login` (JSON: the MD5 of the password, the app id and
  serial, the country `US` and the time zone, like the Home Assistant
  integration) returns a token, sent in the `token` header with `source`,
  `language`, `timezone` and `version`. There is one server for every country
  (`api.us.petlibro.com`). The token is kept in `/data` across restarts.
- **One session per account** at PETLIBRO: a token refused (code 1009) soon
  after its sign-in means the PETLIBRO app uses the same account. The
  integration then waits (never two automatic sign-ins within 15 minutes),
  tries once more, and stops at the second time with a status asking for a
  second account the devices are shared with. An unknown e-mail (1101) or a
  sign-in refused for the account or the password stops until the
  configuration changes or the test button is clicked.
- **Reading**: `device/device/list` every 30 minutes (and on a Discovery
  scan); every poll (120 s by default, 60 to 900), each device:
  `device/device/realInfo`, plus `device/data/grainStatus` (feeders) and
  `device/workRecord/list` when the count of the day moves (and every 30
  minutes), or `data/data/realInfo` and `data/deviceDrinkWater/todayDrinkData`
  (fountains). Errors back off 1, 2, 5, 10 then 15 minutes; a call refused
  for one device keeps its last answer.
- **Devices**: `ext:<selector>:device:<serial>`; the features follow what
  each device reports. Portions are counters, the consumables
  `maintenance`/`life-remaining` (percent of their cycle) and `duration` in
  days, water in mL (`volume-sensor`).
- **Commands**: push buttons `device/device/manualFeeding` (`grainNum`, the
  portions of the configuration), `desiccantReset`, `filterReset`,
  `machineCleaningReset`; switches `device/setting/updateFeedingPlanSwitch`
  and `device/device/waterModeSetting` (`waterStopSwitch`, Dockstream 2); the
  `feed` scene action takes 1 to 48 portions (16 on the Air).
- **States**: current values through `publishChangedStates`; the last meal
  dated with its time through `publishStates`, once each. Scene events
  (`meal_dispensed`, `alert_raised`) are queued and all sent; the first
  reading and meals older than 15 minutes are not fired, nor the meals Gladys
  asked for.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/*.json` hold PETLIBRO answers with made-up values, shaped after
the fields the reference projects read (sources in `test/fixtures/petlibro.js`);
`test/helpers/fakePetlibro.js` serves them behind the transport, sign-in,
tokens and commands included. The transport itself is tested against a
loopback HTTP server (gzip, limits, timeout).

## Credits

No JavaScript library of the PETLIBRO API fits a Gladys integration (see
[TODO.md](TODO.md), Decisions): the client is our own, small, on `node:https`.

- [homebridge-petlibro-2](https://github.com/TechPreacher/HomebridgeLibro2)
  (MIT, Sascha Corti / TechPreacher, Praveen Sharma): the sign-in, the
  headers, the token renewal on code 1009, the device list, `realInfo`,
  manual feeding and the fountain detection followed by `src/client.js`;
  licence notice in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- [jjjonesjr33/petlibro](https://github.com/jjjonesjr33/petlibro), the Home
  Assistant integration (GPL-3.0): read as documentation only, nothing copied
  (endpoints, field names and their meaning, supported models, the advice of
  a second account the devices are shared with).
- The npm `petlibro-api` package is not used: it is GPL-3.0-or-later.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. PETLIBRO, Granary and Dockstream are trademarks of their owner;
this project is not affiliated with PETLIBRO.
