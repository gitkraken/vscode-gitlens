---
name: resume-augint
description: Resume work from a previous Intent by Augment agent conversation that was interrupted (e.g., token limit, crash). Reads the prior agent's context and continues seamlessly. Only works in Intent by Augment workspaces.
---

# /resume-augint - Continue Interrupted Work (Intent by Augment)

Pick up where a previous agent left off — no redundant questions, no re-investigation.

## Usage

```
/resume-augint <agent-id-or-path>
```

**Accepted formats:**

- Full agent ID: `agent-4bd8012e-f5f5-4d5a-b202-b03b31e61d06`
- Workspace path: `.workspace/agents/agent-4bd8012e-....json`
- Short ID prefix: `4bd8012e` (matches against known agents)
- Agent name: `Coordinator 2` (fuzzy match against agent list)

## Instructions

### 1. Resolve the Agent

- Use `list_agents(includeCompleted=true)` to find the agent
- Match by ID, ID prefix, or name (case-insensitive)
- If ambiguous, list matches and ask user to pick — this is the ONLY question allowed

### 2. Gather Full Context (do ALL of these in parallel)

- `get_agent_summary(agentId)` — quick overview of what the agent did
- `read_agent_conversation(agentId)` — full conversation history with tool calls
- If the agent has a task note: `read_note(taskNoteId)` — task details and acceptance criteria
- `read_note("spec")` — current workspace spec and task checklist
- `list_note_tasks("spec")` — current task completion status
- `git status` and `git branch` — current repo state

### 3. Build a Situation Report (internal, do NOT print verbose details)

Synthesize from the gathered context:

- **Original goal**: What was the agent trying to accomplish?
- **Completed work**: What tasks/steps were finished?
- **In-progress work**: What was the agent doing when it stopped?
- **Failed/blocked items**: What errored or couldn't proceed?
- **Current state**: Branch, uncommitted changes, task note statuses
- **Remaining work**: What still needs to be done?

### 4. Present a Brief Summary and Continue

Print a SHORT summary (5-10 lines max):

```markdown
## Resuming: [Agent Name]

**Goal:** [one-line description]
**Done:** [completed items]
**Stopped at:** [what was in progress when interrupted]
**Remaining:** [what still needs to be done]
**Current branch:** [branch] | **Uncommitted changes:** [yes/no]

Continuing with [next action]...
```

Then **immediately start working** on the next incomplete item. Do NOT ask for permission to continue — the user invoked `/resume` precisely because they want you to pick up and go.

### 5. Execution Rules

- **Do NOT re-do completed work** — trust the previous agent's results unless evidence of failure
- **Do NOT re-ask questions** the previous agent already answered or investigated
- **Do NOT change approach** unless the previous approach clearly failed — continue the same strategy
- **DO verify** the current state matches expectations (e.g., branches exist, files are as expected)
- **DO check** if delegated sub-agents completed or failed, and handle accordingly
- **DO update** task statuses in the spec as you complete items

## Anti-Patterns

- Asking "What would you like me to do?" — the previous conversation already established this
- Re-running investigation steps that the previous agent already completed
- Printing the entire previous conversation back to the user
- Changing the plan without evidence that the original plan was wrong
- Ignoring failed delegated agents — check their status and retry or handle manually
