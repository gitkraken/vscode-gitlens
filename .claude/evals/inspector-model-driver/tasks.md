# Task suite

Five tasks spanning the inspector's real workload. Each names a **type** (which the decision is made
per), a **setup** (launch args), the **question** the driver must answer, and an **oracle probe** the
orchestrator runs once to establish ground truth. All tasks use the GitLens repo itself as the
workspace unless noted, so `launch({ workspace_path: <repo root> })`.

> Ground truth is whatever the oracle probe returns on a fresh launch **at eval time** — record it in
> `scorecard.md` before scoring. Don't hardcode expected values here; repo state changes.

---

## T1 — Read-only state inspection · type: `read-only`

The cheapest, most mechanical slice. Pure text evidence, no judgment.

- **Setup:** `launch({ commands: ["gitlens.showGraphView"], log_level: "info" })`, then `wait_for_webview({ webview_url: "graph" })`.
- **Question:** How many commit rows are currently rendered in the Graph, and what is the commit
  message text of the top (row 0) commit?
- **Oracle probe:**
  ```
  evaluate_in_webview({ webview_url: "graph", expression:
    "(() => { const rows = document.querySelector('gl-graph-app').shadowRoot.querySelectorAll('[role=\"row\"], .graph-row'); const first = rows[0]; return { count: rows.length, top: first ? first.textContent.trim().slice(0,120) : null }; })()" })
  ```
  (Adjust the selector to the current Graph row markup if it has changed — verify the oracle returns
  sane values before running configs.)
- **Scores 1.0 if:** count within ±1 of oracle and top-message substring matches.

## T2 — Click → state-correct verification · type: `L1-verify`

Tests "did the _right_ thing happen", not "click registered".

- **Setup:** as T1, Graph open.
- **Question:** Click commit row index 2. After the click, does the Inspect / Commit Details panel
  show that same commit? Report the SHA shown in the details panel and whether it matches row 2.
- **Oracle probe:** capture row 2's SHA, click it, then read the details panel SHA:
  ```
  // 1) row SHA
  evaluate_in_webview({ webview_url: "graph", expression:
    "document.querySelector('gl-graph-app').shadowRoot.querySelectorAll('[data-sha],[role=\"row\"]')[2]?.getAttribute('data-sha')" })
  // 2) click row 2 (driver does this via click or a synthetic dispatch), then:
  evaluate_in_webview({ webview_url: "commitDetails", expression:
    "document.querySelector('gl-commit-details-app')?.shadowRoot?.textContent?.match(/[0-9a-f]{7,40}/)?.[0] ?? null" })
  ```
- **Scores 1.0 if:** driver reports the details SHA and correctly states it matches (or, if a known
  quirk prevents matching, correctly reports the mismatch with the two SHAs).

## T3 — Visual / layout check · type: `visual`

The discriminating task: does the config catch a geometry problem? Whole-sweep cheap configs must
_look_; driver-split returns geometry for Opus to judge.

- **Setup:** `launch({ commands: ["gitlens.showHomeView"] })`, then `resize_window({ width: 320, height: 900 })`
  (narrow, to stress layout), `wait_for_webview({ webview_url: "home" })`.
- **Question:** At this narrow width, is any primary Home action/button clipped or overflowing its
  container (horizontal overflow), or is the layout intact? Name the offending element if any.
- **Oracle probe (geometry, not pixels):**
  ```
  evaluate_in_webview({ webview_url: "home", expression:
    "(() => { const root = document.querySelector('gl-home-app').shadowRoot; const host = root.host.getBoundingClientRect(); const bad = [...root.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > host.right + 1 || r.left < host.left - 1); }).map(e => e.tagName.toLowerCase() + (e.className ? '.'+String(e.className).split(' ')[0] : '')); return { overflowCount: bad.length, sample: bad.slice(0,8) }; })()" })
  ```
- **Scores 1.0 if:** the config's verdict (overflow vs intact) matches the oracle's `overflowCount>0`,
  and if overflow it names a plausible offending element. **This is where a text-only driver may beat
  a cheap model eyeballing a screenshot — or vice-versa. Watch it.**

## T4 — Log / console triage · type: `triage`

- **Setup:** `launch({ commands: ["gitlens.showGraphView"] })`; let it settle (`wait_for_webview`).
- **Question:** Were there any **error**-level console messages or error log lines during Graph load?
  If so, quote the first one; if clean, say so.
- **Oracle probe:**
  ```
  read_console({ level: "error", last_n: 50 })
  read_logs({ pattern: "error", last_n: 50 })
  ```
- **Scores 1.0 if:** the config's clean/error verdict matches the oracle and (if errors) the quoted
  message matches one the oracle saw. Penalize configs that dumped the whole unfiltered buffer to get
  there (note it — that's the anti-pattern this whole effort targets).

## T5 — Perf measurement · type: `perf`

- **Setup:** none pre-opened; the driver measures cold Home hydration.
- **Question:** Measure Home hydration time — from showing the Home view to Lit `updateComplete` —
  averaged over 3 samples. Report the average in ms.
- **Oracle probe:** the orchestrator runs the same 3-sample measurement:
  ```
  // per sample: execute_command gitlens.showHomeView, then
  evaluate_in_webview({ webview_url: "home", expression:
    "(async () => { const t0 = performance.now(); await document.querySelector('gl-home-app').updateComplete; return performance.now() - t0; })()" })
  ```
- **Scores 1.0 if:** the config's average is within ±25% of the oracle average and the method is
  sound (used `updateComplete`, 3 samples). 0.5 if a single sample or loose method; 0 if fabricated.

---

## Notes for whoever runs this

- Selectors above are best-effort against current markup — **run each oracle probe yourself first**
  and fix the selector if it returns null, before scoring any config on that task. A broken oracle
  invalidates the task.
- T3 and T5 are the discriminating tasks (visual judgment; disciplined measurement). T1/T2/T4 are
  where a cheap model should be safe — confirm that expectation with data.
