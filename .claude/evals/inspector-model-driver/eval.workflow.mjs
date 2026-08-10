export const meta = {
	name: 'inspector-model-eval',
	description: 'Compare Opus/Sonnet/Haiku driving the vscode-inspector MCP on a fixed task suite',
	whenToUse: 'Run once to decide which model tier should drive live inspection, per task-type.',
	phases: [{ title: 'Ground truth' }, { title: 'Run configs' }, { title: 'Judge' }],
};

// ⚠️ UNTESTED SKELETON. The vscode-inspector is a SINGLE instance — configs MUST run sequentially
// (each agent does its own launch…teardown). This script encodes that structure; fill the {probe}
// slots from tasks.md and confirm each oracle probe returns sane values before trusting results.
// Requires a live instance + Workflow opt-in ("use a workflow"). Prefer the manual README protocol
// for the first run.

const REPO = args?.repo ?? '<absolute repo path>';

// Keep driver_steps identical across configs for a task; see tasks.md for the real probes.
const TASKS = [
	{
		id: 'T1',
		type: 'read-only',
		setup: `launch({ workspace_path: "${REPO}", commands: ["gitlens.showGraphView"], log_level: "info" })`,
		question: 'Rendered Graph row count + top row commit message.',
		probe: '/* T1 probe from tasks.md */',
		visual: false,
	},
	{
		id: 'T2',
		type: 'L1-verify',
		setup: `launch({ workspace_path: "${REPO}", commands: ["gitlens.showGraphView"] })`,
		question: 'Click row 2; does Commit Details show that SHA?',
		probe: '/* T2 probes */',
		visual: false,
	},
	{
		id: 'T3',
		type: 'visual',
		setup: `launch({ workspace_path: "${REPO}", commands: ["gitlens.showHomeView"] }); resize_window({ width: 320, height: 900 })`,
		question: 'Any Home element overflowing at 320px width?',
		probe: '/* T3 geometry probe */',
		visual: true,
	},
	{
		id: 'T4',
		type: 'triage',
		setup: `launch({ workspace_path: "${REPO}", commands: ["gitlens.showGraphView"] })`,
		question: 'Any error console/log lines during Graph load?',
		probe: '/* T4: read_console/read_logs level=error */',
		visual: false,
	},
	{
		id: 'T5',
		type: 'perf',
		setup: `launch({ workspace_path: "${REPO}" })`,
		question: 'Cold Home hydration time, avg of 3 (updateComplete).',
		probe: '/* T5 measurement */',
		visual: false,
	},
];

// [id, model, split] — split=false → whole-sweep (drives + judges); split=true → driver returns raw evidence.
const CONFIGS = [
	{ id: 'C0', model: undefined, split: false }, // Opus inline baseline (runs on the workflow's model)
	{ id: 'C1', model: 'sonnet', split: false },
	{ id: 'C2', model: 'haiku', split: false },
	{ id: 'C3', model: 'sonnet', split: true },
	{ id: 'C4', model: 'haiku', split: true },
];

const ANSWER_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['answer', 'evidence'],
	properties: {
		answer: { type: 'string' },
		evidence: { type: 'string' },
		confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
	},
};

function driverPrompt(task, cfg) {
	const collect = cfg.split
		? `COLLECT raw probe results ONLY (no judgment, no screenshot):\n${task.probe}`
		: `OBSERVE with these calls (batch fields into one evaluate)${task.visual ? '; you may take ONE scoped screenshot and judge it' : ''}:\n${task.probe}`;
	return `Drive a live VS Code + GitLens instance via the vscode-inspector MCP. Do EXACTLY these steps, no extras.
SETUP: ${task.setup}
TASK: ${task.question}
${collect}
TEARDOWN: call teardown when done.
RETURN text only (this IS your result): { answer, evidence, confidence }. ${cfg.split ? 'If you are a driver split config, put raw probe outputs in `evidence` and a literal "(driver — orchestrator judges)" in `answer`.' : ''}`;
}

// --- Ground truth: orchestrator runs each oracle probe once (whole-sweep on the workflow model) ---
phase('Ground truth');
const truth = {};
for (const task of TASKS) {
	const gt = await agent(
		`Establish ground truth for ${task.id}. ${driverPrompt(task, { split: false, visual: task.visual })}`,
		{ label: `truth:${task.id}`, phase: 'Ground truth', schema: ANSWER_SCHEMA },
	);
	truth[task.id] = gt;
	log(`ground truth ${task.id}: ${gt?.answer?.slice(0, 80) ?? 'null'}`);
}

// --- Run configs SEQUENTIALLY per task (single-instance constraint) ---
phase('Run configs');
const results = [];
for (const task of TASKS) {
	for (const cfg of CONFIGS) {
		const r = await agent(driverPrompt(task, cfg), {
			label: `${task.id}:${cfg.id}`,
			phase: 'Run configs',
			model: cfg.model,
			schema: ANSWER_SCHEMA,
		});
		results.push({ task: task.id, type: task.type, config: cfg.id, answer: r });
	}
}

// --- Judge each (task,config) vs ground truth ---
phase('Judge');
const JUDGE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['quality', 'justification'],
	properties: { quality: { type: 'number', enum: [0, 0.5, 1] }, justification: { type: 'string' } },
};
const scored = await parallel(
	results.map(
		r => () =>
			agent(
				`Ground truth for ${r.task}: ${JSON.stringify(truth[r.task])}\nConfig ${r.config} returned: ${JSON.stringify(r.answer)}\nOutput quality 0/0.5/1 and a one-line justification.`,
				{ label: `judge:${r.task}:${r.config}`, phase: 'Judge', schema: JUDGE_SCHEMA },
			).then(v => ({ ...r, ...v })),
	),
);

return { truth, scored: scored.filter(Boolean) };
