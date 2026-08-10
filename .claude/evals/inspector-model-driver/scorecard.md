# Scorecard

Fill in as you run. One block per task; one row per config. Costs are per single run of that
(task, config) cell.

## Ground truth (record before scoring)

| Task | Oracle answer (from the probe on a fresh launch) |
| ---- | ------------------------------------------------ |
| T1   |                                                  |
| T2   |                                                  |
| T3   |                                                  |
| T4   |                                                  |
| T5   |                                                  |

## Results

Legend: **tok** = subagent output tokens (note image-token share for T3), **s** = wall-clock
seconds (`duration_ms`/1000), **calls** = `tool_uses`, **Q** = quality 0/0.5/1.

### T1 — read-only

| Config             | tok | s   | calls | Q   | notes |
| ------------------ | --- | --- | ----- | --- | ----- |
| C0 Opus inline     |     |     |       |     |       |
| C1 Sonnet sweep    |     |     |       |     |       |
| C2 Haiku sweep     |     |     |       |     |       |
| C3 Opus+Sonnet drv |     |     |       |     |       |
| C4 Opus+Haiku drv  |     |     |       |     |       |

### T2 — L1-verify

| Config | tok | s   | calls | Q   | notes |
| ------ | --- | --- | ----- | --- | ----- |
| C0     |     |     |       |     |       |
| C1     |     |     |       |     |       |
| C2     |     |     |       |     |       |
| C3     |     |     |       |     |       |
| C4     |     |     |       |     |       |

### T3 — visual _(discriminating)_

| Config | tok | s   | calls | Q   | notes |
| ------ | --- | --- | ----- | --- | ----- |
| C0     |     |     |       |     |       |
| C1     |     |     |       |     |       |
| C2     |     |     |       |     |       |
| C3     |     |     |       |     |       |
| C4     |     |     |       |     |       |

### T4 — triage

| Config | tok | s   | calls | Q   | notes |
| ------ | --- | --- | ----- | --- | ----- |
| C0     |     |     |       |     |       |
| C1     |     |     |       |     |       |
| C2     |     |     |       |     |       |
| C3     |     |     |       |     |       |
| C4     |     |     |       |     |       |

### T5 — perf _(discriminating)_

| Config | tok | s   | calls | Q   | notes |
| ------ | --- | --- | ----- | --- | ----- |
| C0     |     |     |       |     |       |
| C1     |     |     |       |     |       |
| C2     |     |     |       |     |       |
| C3     |     |     |       |     |       |
| C4     |     |     |       |     |       |

## Cost model (fill in current per-model $/Mtok to convert tokens → $)

| Model     | $/Mtok in | $/Mtok out |
| --------- | --------- | ---------- |
| Opus 4.8  |           |            |
| Sonnet 5  |           |            |
| Haiku 4.5 |           |            |

> Convert each cell's tokens to $ with these rates; the ranking that matters is **$ at equal
> quality**, not raw tokens (image tokens on the cheap model are billed cheaper too).

## Decision rule

Per **task-type**, pick the config with the lowest cost whose **average quality ≥ 0.9**. Expected
shape of the answer (to be confirmed by data, not assumed):

- `read-only` / `L1-verify` / `triage` → likely a cheap driver (C3) or cheap whole-sweep (C1) wins.
- `visual` → likely Opus must see pixels; either C0, or C3 where the driver returns geometry and Opus
  screenshots only when geometry is ambiguous.
- `perf` → measurement is mechanical; a cheap driver (C3) likely wins if it uses `updateComplete`
  correctly. Watch Haiku for method errors.

## Adoption

Translate the winners into skill guidance:

- If a cheap driver wins `read-only`/`L1-verify`/`triage`: add to `/live-exercise` (and `/live-inspect`)
  a "delegate mechanical evidence-collection to a `sonnet` driver subagent; interpret the returned
  text yourself" note, with the Template-D prompt shape.
- Keep `visual` and open-ended next-action selection on Opus.
- Record the final per-task-type model policy here and cite it from the skills.
