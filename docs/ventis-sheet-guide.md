# Ventis Logger — Quick Guide (paste into the Sheet's `guide` tab)

## Labeling rule (cardinal)
Every run's **condition** label is: `building_condition_occupancy`
- **all lowercase, no spaces** (use `_`)
- **NEVER a person's name or a room number** (anonymization — this is the rule that protects the dataset)

Examples: `little_baseline_1person` · `eastwheelock_fanclosed_2person` · `midmass_windowfan_3person`

- **building** = a slug from the list below
- **condition** = what's being tested: `baseline`, `window`, `windowfan`, `fanclosed`, `door_open`, ...
- **occupancy** = `1person`, `2person`, `3person` (count the people in the room)

## Building slugs (use these; add new ones lowercase, no spaces)
`fahey` · `judge` · `eastwheelock` · `little` · `midmass` · `summit` (off-campus)
`cohen` · `bissell` · `brown` · `french` · `mclane` · `hitchcock` · `zimmerman` · `wheeler` · `richardson` · `morton` · `mcculloch` · `russellsage` · `butterfield` · `streeter` · `lord` · `topliff` · `ripley` · `smith` · `woodward` · `gile` · `northmass` · `southfay` · `midfay` · `northfay` · `hinman` · `andres` · `maxwell`

> If your building isn't listed, add it as one lowercase word (no spaces). Keep it consistent across runs.

## Start / stop a run (the `control` tab)
The `control` tab is a **single-row register — only ROW 2 matters.** Editing any other row does nothing.

1. `A2` = logging → `TRUE` to start, `FALSE` to stop
2. `B2` = the condition label (see above)
3. `C2` = `seq` → **bump it to a NEW, higher number every time** you change a command (the device only acts when `seq` increases; the value survives reflash)

If nothing happens: you probably edited the wrong row, or didn't bump `seq`.

## After a run
Run `/ventis-backup` (refreshes SQLite + archives + charts + backs up to OneDrive). Hand off to Diego.
