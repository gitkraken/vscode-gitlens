import type { ChatPromptTemplate } from './models/chat';

export const createBranch: ChatPromptTemplate = {
	id: 'create-branch',
	template: `I need to create a new branch for working on this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}
{{#repository}}
- **Repository:** {{repository}}
{{/repository}}

**Requested Action:** Create a new Git branch{{#worktree}} in a worktree{{/worktree}} for this {{itemType}}.

Please help me:
1. Suggest an appropriate branch name following best practices
2. Create the branch{{#worktree}} and set up a worktree{{/worktree}}
3. Set up the development environment for this work

{{#mcpToolsAvailable}}
You have access to GitKraken MCP tools that can help with Git operations.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['description', 'repository', 'worktree', 'mcpToolsAvailable'],
	mcpTools: ['git_branch', 'git_worktree'],
	followUps: [
		'Set up development environment',
		'Create initial commit structure',
		'Configure branch protection rules',
	],
};

export const createWorktree: ChatPromptTemplate = {
	id: 'create-worktree',
	template: `I need to create a new worktree for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}

**Requested Action:** Create a new Git worktree for isolated development.

Please help me:
1. Create a new worktree with an appropriate name
2. Set up the branch for this {{itemType}}
3. Configure the workspace for development

{{#mcpToolsAvailable}}
You have access to GitKraken MCP tools for Git worktree management.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['description', 'mcpToolsAvailable'],
	mcpTools: ['git_worktree', 'git_branch'],
	followUps: ['Switch to the new worktree', 'Set up development dependencies', 'Create initial file structure'],
};

export const explainIssue: ChatPromptTemplate = {
	id: 'explain-issue',
	template: `Please help me understand this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}
{{#repository}}
- **Repository:** {{repository}}
{{/repository}}

**Requested Action:** Analyze and explain this {{itemType}} to help me understand:
1. The problem or feature being described
2. Potential implementation approaches
3. Areas of the codebase that might be affected
4. Any dependencies or prerequisites

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to gather additional context about the repository and related issues/PRs.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['description', 'repository', 'mcpToolsAvailable'],
	mcpTools: ['issues_get_detail', 'pull_request_get_detail', 'repository_get_file_content'],
	followUps: ['Create implementation plan', 'Identify related files', 'Estimate development effort'],
};

export const suggestImplementation: ChatPromptTemplate = {
	id: 'suggest-implementation',
	template: `I need implementation suggestions for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}

**Requested Action:** Provide implementation guidance including:
1. Suggested approach and architecture
2. Key files and components to modify
3. Step-by-step implementation plan
4. Testing strategy
5. Potential challenges and solutions

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to examine the current codebase and understand the context better.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['description', 'mcpToolsAvailable'],
	mcpTools: ['repository_get_file_content', 'issues_get_detail'],
	followUps: ['Create detailed task breakdown', 'Set up development branch', 'Write initial tests'],
};

export const reviewChanges: ChatPromptTemplate = {
	id: 'review-changes',
	template: `I need help reviewing this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}

**Requested Action:** Review the changes and provide feedback on:
1. Code quality and best practices
2. Potential issues or improvements
3. Test coverage and completeness
4. Documentation updates needed
5. Security considerations

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to examine the PR details, comments, and file changes.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['description', 'mcpToolsAvailable'],
	mcpTools: ['pull_request_get_detail', 'pull_request_get_comments', 'repository_get_file_content'],
	followUps: ['Add review comments', 'Suggest improvements', 'Check test coverage'],
};

export const switchToBranch: ChatPromptTemplate = {
	id: 'switch-to-branch',
	template: `I want to switch to work on this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me switch to the appropriate branch for this {{itemType}} and set up the development environment.

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to manage Git branches and worktrees.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['mcpToolsAvailable'],
	mcpTools: ['git_branch', 'git_worktree'],
	followUps: ['Update dependencies', 'Run tests', 'Check recent changes'],
};

export const createTests: ChatPromptTemplate = {
	id: 'create-tests',
	template: `I need to create tests for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me create comprehensive tests including unit tests, integration tests, and any necessary test fixtures.

{{#mcpToolsAvailable}}
You can examine the codebase to understand existing test patterns and structures.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['mcpToolsAvailable'],
	mcpTools: ['repository_get_file_content'],
	followUps: ['Run test suite', 'Check coverage', 'Add edge cases'],
};

export const updateDocumentation: ChatPromptTemplate = {
	id: 'update-documentation',
	template: `I need to update documentation for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me update relevant documentation including README files, API docs, and user guides.

{{#mcpToolsAvailable}}
You can examine existing documentation to maintain consistency.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['mcpToolsAvailable'],
	mcpTools: ['repository_get_file_content'],
	followUps: ['Review documentation', 'Update examples', 'Check links'],
};

export const analyzeDependencies: ChatPromptTemplate = {
	id: 'analyze-dependencies',
	template: `I need to analyze dependencies for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me understand and analyze the dependencies, potential conflicts, and impact on the codebase.

{{#mcpToolsAvailable}}
You can examine package files and dependency configurations.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['mcpToolsAvailable'],
	mcpTools: ['repository_get_file_content'],
	followUps: ['Update dependencies', 'Check for vulnerabilities', 'Test compatibility'],
};

export const estimateEffort: ChatPromptTemplate = {
	id: 'estimate-effort',
	template: `I need an effort estimate for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me estimate the development effort, complexity, and timeline for implementing this {{itemType}}.

{{#mcpToolsAvailable}}
You can examine the codebase to understand the scope and complexity.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['mcpToolsAvailable'],
	mcpTools: ['repository_get_file_content', 'issues_get_detail'],
	followUps: ['Create task breakdown', 'Set milestones', 'Plan sprints'],
};

export const startWork: ChatPromptTemplate = {
	id: 'start-work',
	template: `I need to start work on this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}
{{#repository}}
- **Repository:** {{repository}}
{{/repository}}

**Requested Action:** Help me plan, estimate, and implement a solution for this {{itemType}}.

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to gather additional context about the repository and related issues/PRs.
{{/mcpToolsAvailable}}`,
	requiredVariables: ['itemType', 'title', 'id', 'url'],
	optionalVariables: ['description', 'repository', 'mcpToolsAvailable'],
	mcpTools: ['issues_get_detail', 'repository_get_file_content'],
	followUps: ['Create implementation plan', 'Identify related files', 'Estimate development effort'],
};
