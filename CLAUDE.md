# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It signs in to the
PETLIBRO cloud with a PETLIBRO account (preferably a second account the
devices are shared with), reads the feeders (Granary, Air, One RFID, Space,
Polar) and the Dockstream fountains, turns them into Gladys devices and
states, dispenses food, switches the feeding plan and the pump, resets the
consumables, and fires scene events when a meal is dispensed or an alert
starts. Unofficial, not affiliated with PETLIBRO.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          PetlibroApp: poll loop, failures and pauses, devices,
                    states, scene events, commands, badges, test button
src/client.js       the account: sign-in, token, rationing (15 min gap,
                    kicked tokens), the calls
src/petlibro.js     the only network access (node:https, gzip, settles once),
                    PETLIBRO codes and errors
src/inventory.js    PETLIBRO answers -> devices, readings, meals (pure)
src/devices.js      -> Gladys devices, current and dated states (pure)
src/events.js       two readings of a device -> scene events (pure)
src/publisher.js    states within 300/min, dated states and scene events queued
src/clock.js        time zones, PETLIBRO dates (pure)
src/store.js        /data/petlibro-state.json: token, last sign-in
src/config.js       config_schema normalized, account key (hash)
src/constants.js    server, paths, app identity, models, timings
src/i18n.js         runtime texts, feature names, alerts (en/fr)
test/fixtures/      PETLIBRO answers (JSON, made-up values) shaped after the references
test/helpers/       a fake PETLIBRO cloud behind the transport; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `device:<serial>` (`deviceSn`),
  feature = `<device>:<role>` (roles in `src/devices.js` FEATURES). Never
  change how they are built.
- Manifest keys (`email`, `password`, `timezone`, `poll_interval`,
  `feed_portions`, `language`, `test_connection`, the two scene triggers, the
  `feed` scene action, their fields, variables and outputs, the alert values)
  are frozen: users store them in devices and scenes.
- Value conventions: the PETLIBRO side is the API's (`surplusGrain` true =
  food left, `waterStopSwitch` true = pump stopped, `powerType` 3 mains / 2
  battery, epoch milliseconds); the Gladys side the enums of the core
  `server/utils/constants.js` (level state 0 low, 1 normal; binary 1 = on;
  button push 1). The SDK exports the categories, types and units, not the
  values: they are in `src/constants.js`.
- Never send a unit Gladys does not accept for the category
  (test/devices.test.js holds the whitelist).
- The last meal is a dated state (`publisher.pushEvent`, publishStates), sent
  once per key; scene events go through `publisher.pushSceneEvent` and are
  never deduplicated. Never fire an event from a command received from Gladys
  (the meals Gladys asked for are skipped).
- **Sign-ins are rationed**: one session per PETLIBRO account, a sign-in signs
  the app out. Never two automatic sign-ins within `TIMINGS.loginGap`; an
  unknown e-mail, a refused sign-in or a second kicked token stop until a
  configuration change or the test button. Never log or put in a status
  message the password, its hash or the token.
- Polling politely: `realInfo` per device, `grainStatus` per feeder and its
  meals only when the count of the day moves, two more calls per fountain,
  the device list every 30 minutes, 60 s minimum. Never add a call outside
  `PetlibroClient`.
- **Licences**: jjjonesjr33/petlibro is GPL-3.0 and `petlibro-api` GPL-3.0+:
  read the former as documentation only, never copy code, text or data from
  them. homebridge-petlibro-2 is MIT: its notice stays in
  `THIRD-PARTY-NOTICES.md` (copied into the image).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network. Gladys rate limits: 300 states/min, 300 scene
  events/min.
- Tests never touch the network: the transport is injected
  (`test/petlibro.test.js` uses a loopback server for the real one).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
