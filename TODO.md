# TODO — PETLIBRO v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #224) gets one recap message there, with
  a link to each repo.

## Status

- [x] **Milestone 1 — core** (2026-10-16): PETLIBRO account (e-mail,
      password, time zone of the devices), token kept in `/data` until
      PETLIBRO refuses it (code 1009), sign-ins rationed (15 minutes apart; a
      token refused soon after its sign-in = the PETLIBRO app uses the same
      account: one more try, then a stop; unknown e-mail or refused sign-in:
      stop), device list every 30 minutes, per poll (120 s, 60–900) `realInfo`
      of each device, `grainStatus` of the dry food feeders and their
      `workRecord/list` when the count of the day moves (every 30 minutes at
      least), `data/data/realInfo` and `todayDrinkData` of the fountains;
      backoff; devices for the dry food feeders (5 models), the Polar wet
      food feeder, the Dockstream fountains (4 models), unknown PLAF/PLWF
      models read as feeders/fountains; "Feed now" button, feeding plan and
      pump switches, desiccant/filter/cleaning reset buttons, `feed` scene
      action; scene triggers `meal_dispensed`, `alert_raised`; badges; "Test
      the connection"; en/fr names; docs en/fr. Tested against made-up
      answers shaped after the references only.
- [ ] **Milestone 2 — real account**: run against a real account and compare
      with the app (see "To check on a real account"); turn the answers
      (anonymized) into fixtures; add the fallbacks real answers need.
- [ ] **Milestone 3 — more**:
  - the Luma litter box (`execCmdService` CLEAN/EMPTY/LEVELING…, waste bin,
    litter weight, filter/mat days), the Granary Camera events
    (`data/event/deviceEventsV2`: motion, sound) as scene triggers;
  - the Polar: its plates (`wetFeedingPlan/manualFeedNow`, `stopFeedNow`,
    `platePositionChange`), the next meal of its plan;
  - feeders: skip today's meals (`feedingPlan/enableTodayAll`), the plans
    themselves (`feedingPlan/list`, next meal time and portions), lid,
    child lock, light, sound, display settings, firmware updates
    (`ota/getUpgrade`);
  - fountains: water dispensing mode (constant, intermittent, sensor),
    low-water threshold, per-pet drinks of the RFID models (`wear/wearListV2`);
  - the pets of the account (`pets`), with their meals and drinks.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## To check on a real account

- The sign-in: does the country `US` work for a European account (Home
  Assistant offers nothing else; Homebridge says the server is the same for
  every country)? The code and message of a wrong password (the fake cloud
  uses a made-up 1102 `PASSWORD_ERROR`; the integration stops on any sign-in
  refusal whose message names the account, the e-mail or the password). Does
  the answer carry a lifetime (`expires_in`)? Homebridge assumes one hour
  without seeing it; Home Assistant keeps the token until 1009.
- How fast the app invalidates our token when it signs in with the same
  account, and whether a second account the devices are shared with keeps its
  own session (the advice of both references).
- Feeders: where `remainingDesiccantDays` comes from (Home Assistant merges
  the device list, `baseInfo`, `realInfo` and `getAttributeSetting`; here the
  device list and `realInfo`), `changeDesiccantFrequency` in days, the
  two-hopper Granary fields (`leftWarehouseSurplusGrain`…), `powerType` vs
  `powerMode` per model, the unit of `todayFeedingQuantity` (portions?),
  whether `workRecord/list` has an `id` per record and its order, whether a
  meal asked through `manualFeeding` shows there (and how fast), the
  `manualFeeding` answer (an id?).
- Polar: `surplusGrain`, `temperature` and the cleaning fields in `realInfo`.
- Fountains: `lowWater` in mL against `weight` in grams, `waterStopSwitch` on
  the first Dockstream, `exceptionMessage` values, `powerState` on the
  Cordless, `todayTotalMl` decimals.
- The codes of a call refused for a device (offline, unknown): the fake cloud
  uses made-up 5001/5002.
- Rate limits: none documented; Home Assistant reads every device every
  minute with about ten calls.

## Decisions

- **Not a duplicate** (checked 2026-10-16): the Gladys core master
  (0027571e) has no PETLIBRO service (`git grep -i
"petlibro|dockstream|granary"` empty) and PETLIBRO devices are not Matter.
  The store index (433 entries, generated 2026-10-16T11:15Z) has no PETLIBRO
  integration; GitHub search "gladys petlibro" finds only this repo; the
  tracker entry n° 322 "petlibro" (P2) was free; claimed by Louis in
  /t/10385 #224. Complements LM1LC3N7/gladys-petkit (PetKit),
  LM1LC3N7/gladys-surepetcare (Sure Petcare), guim31/gladys-tractive (GPS):
  other brands.
- **Own client, no dependency** (Louis's rule: reuse maintained work, rewrite
  dead or debt-heavy code). The candidates, 2026-10-16:
  - `petlibro-api` (npm 1.0.1, jakenology/node-petlibro): GPL-3.0-or-later,
    not compatible with this Apache-2.0 repo. Not used.
  - `homebridge-petlibro-2` (npm 1.5.2, 2026-06-20, MIT, TechPreacher, active,
    axios): a Homebridge platform plugin, not a library (feeders: manual feed
    only; fountains: water level only). Its client (~150 lines) is followed
    by `src/client.js` (sign-in, headers, 1009 renewal, token persistence,
    `realInfo` with `id` and `deviceSn`, manual feeding, fountain detection
    by name and serial), with its licence notice in
    `THIRD-PARTY-NOTICES.md`.
  - jjjonesjr33/petlibro (Python, Home Assistant, very active, last commit
    2026-09-22): GPL-3.0, read as documentation only (endpoints, fields,
    models, the second account advice); no code, text or data copied.
    The integration needs a sign-in and about twelve calls: ~500 lines
    (client and transport) on `node:https`. Runtime dependencies: the SDK
    only.
- **One server**: `api.us.petlibro.com` (`api.eu.petlibro.com` and
  `api.petlibro.com` do not resolve, checked 2026-10-16; Homebridge 1.5.1
  reverted a guessed EU server). No region option; the sign-in sends the
  country `US` like Home Assistant (its only choice).
- **Tokens**: kept in `/data` with a hash of the e-mail, reused across
  restarts, until PETLIBRO refuses them (1009, probed without a token on
  2026-10-16) or a lifetime it gives runs out (none seen in the references).
  Home Assistant keeps the token; Homebridge's one-hour default would sign in
  (and sign the app out) every hour: not followed. A token refused less than
  30 minutes after its sign-in counts as "kicked"; the next sign-in waits 15
  minutes, a second kick stops until the user acts. An unknown e-mail (1101,
  probed with a made-up address) or a sign-in refused for the account or the
  password stops at once. The last sign-in time is kept in `/data`, so a
  restart loop cannot hammer the sign-in.
- **Polling politely**: 120 s by default (Home Assistant 60 s with ~10 calls
  per device), 2 calls per feeder (`realInfo`, `grainStatus`) + the meals
  only when the count of the day moves, 3 per fountain, 1 per Polar; the
  device list every 30 minutes. `baseInfo`, `getAttributeSetting`,
  `getUpgrade` and `feedingPlan/todayNew` are not read in milestone 1.
- **Features follow the reading**: a feature exists when the device reports
  its field; a role seen once stays for the life of the process, so a
  reading without a field does not change the device structure.
- **Gladys types**: food and water levels = `level-sensor`/`liquid-state`
  (0 low, 1 normal; water low when `weight` ≤ the `lowWater` threshold of the
  fountain, so only on the models that report it); water level =
  `liquid-level-percent`; water left and drunk today = `volume-sensor` in
  mL; portions and counts = `counter-sensor`; consumables =
  `maintenance`/`life-remaining` (days left over the cycle of the app, in
  percent) next to `duration` in days; battery low = `battery-low`; charging
  = `battery`/`charging`; mains power and online = `input`/`binary`;
  temperature (Polar) = `temperature-sensor` in °C.
- **Commands**: "Feed now" = `button`/`push` dispensing the portions of the
  configuration (1 by default, like Homebridge's `portions`); the `feed` scene
  action 1–48 portions (16 on the Air: Home Assistant's `max_feed_portions`).
  Feeding plan and pump = `switch`/`binary` (the pump only on the Dockstream
  2, the only ones Home Assistant lets stop); after a switch command the
  remembered value is forgotten so the next reading resends the real one.
  Desiccant, filter and cleaning resets = push buttons.
- **Events**: meals = `GRAIN_OUTPUT_SUCCESS` records, keyed by `id` (else
  time and portions); alerts = a condition that starts. The first reading
  and meals older than 15 minutes are history. A meal within 10 minutes of a
  Gladys feed command fires no event (one per command): no scene loop.
- **Unsupported**: the Luma litter box and products that are neither a PLAF
  feeder nor a PLWF fountain are skipped and logged once; the test button
  counts them.
