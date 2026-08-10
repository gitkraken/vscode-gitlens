# Driver prompt templates

Subagents do **not** inherit `/live-*` discipline — every inspector step must be spelled out, or a
cheaper model will improvise and the comparison is meaningless. Use the template that matches the
config, fill the `{{…}}` slots from `tasks.md`, and spawn via the `Agent` tool with `model` set
(`sonnet` for C1/C3, `haiku` for C2/C4). C0 (Opus inline) you perform yourself using the same steps.

Keep the driving steps **identical across configs** for a given task — only the model and the
whole-sweep-vs-driver framing change. Otherwise you're measuring prompt differences, not models.

---

## Template W — whole-sweep (C1 Sonnet, C2 Haiku)

The cheap model drives _and_ judges, and returns the answer as text.

```
You are driving a live VS Code + GitLens instance through the `vscode-inspector` MCP tools to answer
ONE question. Do exactly these steps — do not add exploratory steps.

SETUP:
{{setup}}   // e.g. launch({ workspace_path: "<repo>", commands: ["gitlens.showGraphView"], log_level: "info" }); wait_for_webview({ webview_url: "graph" })

TASK:
{{question}}

HOW TO OBSERVE (use these exact tool calls; batch fields into one evaluate where possible):
{{driver_steps}}   // the probe(s) from the task; for the `visual` task you MAY also take one scoped
                   // screenshot ({ target: "webview", webview_url: "home" }) and judge it — this is
                   // the point of the whole-sweep config.

TEARDOWN: call teardown when done.

RETURN (text only — this IS your result, not a message to a human):
- answer: <your direct answer to the TASK>
- evidence: <the probe values / what you observed that support it>
- confidence: high | medium | low
Return nothing else.
```

## Template D — driver split (C3 Sonnet driver, C4 Haiku driver)

The cheap model is a **dumb-but-careful executor**: it runs fixed probes and returns raw evidence as
text. It does **not** judge. The orchestrator (Opus) interprets afterward, and for the `visual` task
the orchestrator takes its own screenshot rather than trusting a cheap-model description.

```
You are a data-collection driver for a live VS Code + GitLens instance via the `vscode-inspector`
MCP. Run EXACTLY the steps below and return the raw results. Do NOT interpret, judge, or add steps.

SETUP:
{{setup}}

COLLECT (run each and capture the raw return value verbatim):
{{driver_steps}}   // the oracle-equivalent probe(s) only — NO screenshot for driver configs

TEARDOWN: call teardown when done.

RETURN (text only — raw evidence, no conclusions):
- probe_results: <each tool call's raw JSON/text output, labeled>
Return nothing else.
```

Then the orchestrator (Opus) reads `probe_results` and forms the answer itself. For T3 (`visual`)
under C3/C4, after the driver returns geometry the orchestrator additionally calls `screenshot`
itself (in the main loop) if it wants pixels — count those orchestrator tokens against the config.

---

## Capturing metrics

Each spawned driver's completion notification carries `usage`:
`subagent_tokens`, `tool_uses`, `duration_ms`. Record them in `scorecard.md`. For C0 and for the
orchestrator's share of C3/C4, tally your own inspector turns (tool_uses) and note any screenshots
you took (image tokens).

## Judging

After all configs for a task have run, spawn one Opus judge:

```
Ground truth for {{task_id}}: {{oracle_answer}}
Here is what each config returned: {{per-config answers}}
For each config, output quality ∈ {0, 0.5, 1} (wrong / partially correct / correct) and a one-line
justification. Be strict: a right answer reached by dumping the whole console unfiltered is still
correct on quality but flag the inefficiency separately.
```

Hand-verify the judge on at least one config per task before trusting it.
