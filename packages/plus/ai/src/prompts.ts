import type { PromptTemplate } from './models/promptTemplates.js';

export const generateCommitMessage: PromptTemplate<'generate-commitMessage'> = {
	id: 'generate-commitMessage_v2',
	variables: ['diff', 'context', 'instructions'],
	template: `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise but meaningful commit message. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative commit message that accurately represents the modifications made to the code

First, examine the following code changes provided in Git diff format:
<~~diff~~>
\${diff}
</~~diff~~>

Now, if provided, use this context to understand the motivation behind the changes and any relevant background information:
<~~additional-context~~>
\${context}
</~~additional-context~~>

To create an effective commit message, follow these steps:

1. Carefully analyze the diff and context, focusing on:
   - The purpose and rationale of the changes
   - Any problems addressed or benefits introduced
   - Any significant logic changes or algorithmic improvements
2. Ensure the following when composing the commit message:
   - Emphasize the 'why' of the change, its benefits, or the problem it addresses
   - Use an informal yet professional tone
   - Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')
   - Be clear and concise
   - Synthesize only meaningful information from the diff and context
   - Avoid outputting code, specific code identifiers, names, or file names unless crucial for understanding
   - Avoid repeating information, broad generalities, and unnecessary phrases like "this", "this commit", or "this change"
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the summary of your commit message
   - Start with a third-person singular present tense verb
   - Limit to 50 characters if possible
4. If necessary, provide a brief explanation of the changes, which will be the body of your commit message
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes
5. If the changes are related to a specific issue or ticket, include the reference (e.g., "Fixes #123" or "Relates to JIRA-456") at the end of the commit message

Write your commit message summary inside <summary> tags and your commit message body inside <body> tags and include no other text
Example output structure:
<summary>
[commit-message-summary-goes-here]
</summary>
<body>
[commit-message-body-goes-here]
</body>

\${instructions}

Based on the provided code diff and any additional context, create a concise but meaningful commit message following the instructions above`,
};

export const generateCreatePullRequest: PromptTemplate<'generate-create-pullRequest'> = {
	id: 'generate-create-pullRequest_v2',
	variables: ['diff', 'data', 'context', 'instructions'],
	template: `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise but meaningful pull request title and description. You will be provided with a code diff and a list of commits. Your goal is to analyze the changes and create a clear, informative title and description that accurately represents the modifications made to the code
First, examine the following code changes provided in Git diff format:
<~~diff~~>
\${diff}
</~~diff~~>

Then, review the list of commits to help understand the motivation behind the changes and any relevant background information:
<~~data~~>
\${data}
</~~data~~>

Now, if provided, use this context to understand the motivation behind the changes and any relevant background information:
<~~additional-context~~>
\${context}
</~~additional-context~~>

To create an effective pull request title and description, follow these steps:

1. Carefully analyze the diff, commit messages, context, focusing on:
   - The purpose and rationale of the changes
   - Any problems addressed or benefits introduced
   - Any significant logic changes or algorithmic improvements
2. Ensure the following when composing the pull request title and description:
   - Emphasize the 'why' of the change, its benefits, or the problem it addresses
   - Use an informal yet professional tone
   - Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')
   - Be clear and concise
   - Synthesize only meaningful information from the diff and context
   - Avoid outputting code, specific code identifiers, names, or file names unless crucial for understanding
   - Avoid repeating information, broad generalities, and unnecessary phrases like "this", "this commit", or "this change"
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the title of your pull request
   - Start with a third-person singular present tense verb
   - Limit to 50 characters if possible
4. Provide a detailed explanation of the changes, which will be the body of your pull request
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes
   - Structure the body with markdown bullets and headings for clarity
5. If the changes are related to a specific issue or ticket, include the reference (e.g., "Fixes #123" or "Relates to JIRA-456") at the end of the pull request message

Write your title inside <summary> tags and your description inside <body> tags and include no other text
Example output structure:
<summary>
[pull-request-title-goes-here]
</summary>
<body>
[pull-request-body-goes-here]
</body>

\${instructions}

Based on the provided code diff, commit list, and any additional context, create a concise but meaningful pull request title and body following the instructions above`,
};

export const generateStashMessage: PromptTemplate<'generate-stashMessage'> = {
	id: 'generate-stashMessage_v2',
	variables: ['diff', 'context', 'instructions'],
	template: `You are an advanced AI programming assistant and are tasked with creating a concise but descriptive stash message. You will be provided with a code diff of uncommitted changes. Your goal is to analyze the changes and create a clear, single-line stash message that accurately represents the work in progress being stashed

First, examine the following code changes provided in Git diff format:
<~~diff~~>
\${diff}
</~~diff~~>

To create an effective stash message, follow these steps:

1. Analyze the changes and focus on:
   - The primary feature or bug fix was being worked on
   - The overall intent of the changes
   - Any notable file or areas being modified
2. Create a single-line message that:
   - Briefly describes the changes being stashed but must be descriptive enough to identify later
   - Prioritizes the most significant change if multiple changes are present. If multiple related changes are significant, try to summarize them concisely
   - Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')

Write your stash message inside <summary> tags and include no other text
Example output structure:
<summary>
[stash-message-goes-here]
</summary>

\${instructions}

Based on the provided code diff, create a concise but descriptive stash message following the instructions above`,
};

export const generateCreateCloudPatch: PromptTemplate<'generate-create-cloudPatch'> = {
	id: 'generate-create-cloudPatch_v2',
	variables: ['diff', 'context', 'instructions'],
	template: `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise and meaningful title and description. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative title and description that accurately represents the modifications made to the code

First, examine the following code changes provided in Git diff format:
<~~diff~~>
\${diff}
</~~diff~~>

Now, if provided, use this context to understand the motivation behind the changes and any relevant background information:
<~~additional-context~~>
\${context}
</~~additional-context~~>

To create an effective title and description, follow these steps:

1. Carefully analyze the diff and context, focusing on:
   - The purpose and rationale of the changes
   - Any problems addressed or benefits introduced
   - Any significant logic changes or algorithmic improvements
2. Ensure the following when composing the title and description:
   - Emphasize the 'why' of the change, its benefits, or the problem it addresses
   - Use an informal yet professional tone
   - Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')
   - Be clear and concise
   - Synthesize only meaningful information from the diff and context
   - Avoid outputting code, specific code identifiers, names, or file names unless crucial for understanding
   - Avoid repeating information, broad generalities, and unnecessary phrases like "this", "this commit", or "this change"
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the title
4. Provide a detailed explanation of the changes, which will be the description
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes

Write your title inside <summary> tags and your description inside <body> tags and include no other text
Example output structure:
<summary>
[cloud-patch-title-goes-here]
</summary>
<body>
[cloud-patch-description-goes-here]
</body>

\${instructions}

Based on the provided code diff and any additional context, create a concise but meaningful title and description following the instructions above`,
};

export const generateCreateCodeSuggest: PromptTemplate<'generate-create-codeSuggestion'> = {
	id: 'generate-create-codeSuggestion_v2',
	variables: ['diff', 'context', 'instructions'],
	template: `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise and meaningful code review title and description. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative code review title and description that accurately represents the modifications made to the code

First, examine the following code changes provided in Git diff format:
<~~diff~~>
\${diff}
</~~diff~~>

Now, if provided, use this context to understand the motivation behind the changes and any relevant background information:
<~~additional-context~~>
\${context}
</~~additional-context~~>

To create an effective title and description, follow these steps:

1. Carefully analyze the diff and context, focusing on:
   - The purpose and rationale of the changes
   - Any problems addressed or benefits introduced
   - Any significant logic changes or algorithmic improvements
2. Ensure the following when composing the title and description:
   - Emphasize the 'why' of the change, its benefits, or the problem it addresses
   - Use an informal yet professional tone
   - Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')
   - Be clear and concise
   - Synthesize only meaningful information from the diff and context
   - Avoid outputting code, specific code identifiers, names, or file names unless crucial for understanding
   - Avoid repeating information, broad generalities, and unnecessary phrases like "this", "this commit", or "this change"
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the title
4. Provide a detailed explanation of the changes, which will be the description
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes

Write your title inside <summary> tags and your description inside <body> tags and include no other text
Example output structure:
<summary>
[code-suggestion-title-goes-here]
</summary>
<body>
[code-suggestion-description-goes-here]
</body>

\${instructions}

Based on the provided code diff and any additional context, create a concise but meaningful code review title and description following the instructions above`,
};

export const explainChanges: PromptTemplate<'explain-changes'> = {
	id: 'explain-changes',
	variables: ['diff', 'message', 'instructions'],
	template: `You are an advanced AI programming assistant and are tasked with creating clear, technical summaries of code changes that help reviewers understand the modifications and their implications. You will analyze a code diff and the author-provided message to produce a structured summary that captures the essential aspects of the changes

First, examine the following code changes provided in Git diff format:
<~~diff~~>
\${diff}
</~~diff~~>

Now, review the author-provided message to help understand the motivation behind the changes and any relevant background information:
<~~message~~>
\${message}
</~~message~~>

Analysis Instructions:
1. Examine the technical changes and their direct implications
2. Consider the scope of changes (small fix vs. major modification)
3. Identify any structural or behavioral changes
4. Look for potential side effects or dependencies
5. Note any obvious testing implications

Write your summary inside <summary> and <body> tags in the following structured markdown format, text in [] brackets should be replaced with your own text, if applicable, not including the brackets:
<summary>
[Concise, one-line description of the change]

[2-3 sentences explaining the core changes and their purpose]
</summary>
<body>
### Changes
- [Key technical modifications]
- [Important structural changes]
- [Modified components/files]

### Impact
- [Behavioral changes]
- [Dependencies affected]
- [Breaking changes, if any]
- [Performance implications, if apparent]
</body>

Guidelines:
- Keep the initial description under 80 characters
- Use clear, technical language
- Focus on observable changes from the diff
- Highlight significant code structure changes
- Base conclusions only on the code diff and message
- Avoid assumptions about business context
- Include specific file/component names only when relevant

\${instructions}

Based on the provided code diff and message, create a focused technical summary following the format above`,
};

export const generateChangelog: PromptTemplate<'generate-changelog'> = {
	id: 'generate-changelog',
	variables: ['data', 'instructions'],
	template: `You are an expert at creating changelogs in the "Keep a Changelog" format (https://keepachangelog.com). Your task is to create a set of clear, informative changelog entries

First, carefully examine the following JSON data containing commit messages and associated issues. The data is structured as an array of "change" objects. Each "change" contains a \`message\` (the commit message) and an \`issues\` array. The \`issues\` array contains objects representing associated issues, each with an \`id\`, \`url\`, and optional \`title\`

<~~data~~>
\${data}
</~~data~~>

Guidelines for creating the changelog:

1. Analyze the commit messages and associated issue titles (if available) to understand the changes made. Be sure to read every commit message and associated issue titles to understand the purpose of each change
2. Group changes into these categories (only include categories with actual changes):
   - Added: New features or capabilities
   - Changed: Changes to existing functionality
   - Deprecated: Features that will be removed in upcoming releases
   - Removed: Features that were removed
   - Fixed: Bug fixes
   - Security: Security-related changes
3. Order entries by importance within each category
4. Write a clear, concise, user-friendly descriptions for each change that focuses on the impact to users
   - Follow the example structure below of the Keep a Changelog format for each entry
   - Start with a third-person singular present tense verb (e.g., "Adds", "Changes", "Improves", "Removes", "Deprecates", "Fixes", etc.)
   - Avoid technical implementation details unless directly relevant to users
   - Combine related changes into single entries when appropriate, grouping the associated issues together as well
   - Focus on the what and why, not the how. One sentence is often sufficient, though bullets can be used for multiple related points
5. Prioritize user-facing changes. If a commit message describes internal refactoring or implementation details, try to infer the user-facing impact (if any) from the issue titles or other commits. If there's no user-facing impact, and no clear external benefit, omit the change
6. Use Markdown headings, links, and bullet points, adhering to Keep a Changelog structure
7. Provide only the changelog entry---no additional text or commentary outside of the changelog

Example output structure:

### Added
- Adds brief description of the added feature ([#Issue-ID](Issue-URL))

### Changed
- Changes brief description of how something changed ([#Issue-ID](Issue-URL))
- Improves brief description of how something improved ([#Issue-ID](Issue-URL))

### Fixed
- Fixes Issue Title or brief description if no title ([#Issue-ID](Issue-URL))

\${instructions}

Based on the provided commit messages and associated issues, create a set of markdown changelog entries following the instructions above. Do not include any explanatory text or metadata`,
};

export const generateSearchQuery: PromptTemplate<'generate-searchQuery'> = {
	id: 'generate-searchQuery_v2',
	variables: ['query', 'date', 'context', 'instructions'],
	template: `You are an advanced AI assistant that converts natural language queries into structured Git search operators. Your task is to analyze a user's natural language query about their Git repository history and convert it into the appropriate search operators.

Available search operators:
- 'message:' - Search in commit messages (e.g. 'message:fix bug'); maps to \`git log --extended-regexp --grep=<value>\`
- 'author:' - Search by a specific author (e.g. 'author:eamodio' or use '@me' for current user); maps to \`git log --author=<value>\`
- 'commit:' - Search by a specific commit SHA (e.g. 'commit:4ce3a')
- 'file:' - Search by file path (e.g. 'file:"package.json"', 'file:"*.ts"'); maps to \`git log -- <value>\`
- 'change:' - Search by specific code changes using regular expressions (e.g. 'change:"function.*auth"', 'change:"import.*react"'); maps to \`git log -G<value>\`
- 'type:' - Search by type -- supports stash and tip (e.g. 'type:stash', 'type:tip')
- 'ref:' - Search for commits reachable by a reference (branch, tag, commit) or reference range. Supports single refs (e.g. 'ref:main', 'ref:v1.0'), two-dot ranges (e.g. 'ref:main..feature' for commits in feature but not in main), three-dot ranges (e.g. 'ref:main...feature' for symmetric difference), and relative refs (e.g. 'ref:HEAD~5..HEAD'); maps to \`git log <ref>\`
- 'after:' - Search for commits after a certain date or range (e.g. 'after:2023-01-01', 'after:"6 months ago"', 'after:"last Tuesday"', 'after:"noon"', 'after:"1 month 2 days ago"'); maps to \`git log --since=<value>\`
- 'before:' - Search for commits before a certain date or range (e.g. 'before:2023-01-01', 'before:"6 months ago"', 'before:"yesterday"', 'before:"3PM GMT"'); maps to \`git log --until=<value>\`

File and change values should be double-quoted. You can use multiple message, author, file, change, and ref operators at the same time if needed.

Use 'ref:' when the query involves exploring commit history within or between specific references. Use temporal operators ('after:', 'before:') for date-based filtering. These operators can be combined when appropriate.

IMPORTANT: When "after" or "since" is used with a reference (branch, tag, commit SHA), it refers to commit ancestry, not time. Use ref ranges (e.g., 'ref:v1.0..HEAD' for "commits after tag v1.0"). Only use 'after:' for actual dates or time expressions.

Temporal queries leverage Git's 'approxidate' parser, which understands relative date expressions like "yesterday", "5 minutes ago", "1 month 2 days ago", "last Tuesday", "noon", and explicit timezones like "3PM GMT".


The current date is \${date}
\${context}

User Query: \${query}

\${instructions}

Convert the user's natural language query into the appropriate search operators. Return only the search query string without any explanatory text. If the query cannot be converted to search operators, return the original query as a message search. For complex temporal expressions that might be ambiguous, prefer simpler, more reliable relative date formats.`,
};

export const generateCommits: PromptTemplate<'generate-commits'> = {
	id: 'generate-commits_v2',
	variables: ['hunks', 'existingCommits', 'commitMessages', 'hunkMap', 'instructions'],
	template: `You are an advanced AI programming assistant tasked with organizing code changes into commits. Your goal is to create a complete set of commits that are related, grouped logically, atomic, and easy to review. You will be working with individual code hunks and may have some existing commits that already have hunks assigned.

First, examine the following JSON array of code hunks that need to be organized:

<hunks>
\${hunks}
</hunks>

Next, examine the following JSON array of existing commits (if any) that already have some hunks assigned:

<existing_commits>
\${existingCommits}
</existing_commits>

Next, examine the following JSON array of commit messages from the commits that the hunks came from:

<commit_messages>
\${commitMessages}
</commit_messages>

Finally, examine the following JSON array which represents a mapping of hunk indices to hunk headers for reference:

<hunk_map>
\${hunkMap}
</hunk_map>

Your task is to create a complete commit organization that includes:
1. All existing commits (unchanged) that already have hunks assigned
2. New commits for any unassigned hunks, organized logically

Follow these guidelines:

1. Preserve all existing commits exactly as they are - do not modify their messages, explanations, or assigned hunks
2. Use the commit messages, if provided, as context to help you understand the source of the hunks. These were commits that are being reorganized, so you do not need to reuse the messages, but they can help you understand the original intent of the changes in the hunks
3. For unassigned hunks, group them into logical units that make sense together and can be applied atomically
4. Use each hunk only once. Ensure all hunks are assigned to exactly one commit
5. Ensure each new commit is self-contained and atomic
6. Order commits logically (existing commits first, then new commits in dependency order)
7. Write a commit message for each new commit using these detailed steps:

7a. Carefully analyze the hunks assigned to each commit, focusing on:
   - The purpose and rationale of the changes
   - Any problems addressed or benefits introduced
   - Any significant logic changes or algorithmic improvements
7b. Ensure the following when composing each commit message:
   - Emphasize the 'why' of the change, its benefits, or the problem it addresses
   - Use an informal yet professional tone
   - Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')
   - Be clear and concise
   - Synthesize only meaningful information from the code changes
   - Avoid outputting code, specific code identifiers, names, or file names unless crucial for understanding
   - Avoid repeating information, broad generalities, and unnecessary phrases like "this", "this commit", or "this change"
7c. Summarize the main purpose of the changes in a single, concise sentence for the first line of the commit message you generate:
   - Start with a third-person singular present tense verb
   - Limit to 50 characters if possible
7d. Then add a blank line followed by some details of the changes, completed as follows:
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes
   - Explain the rationale and benefits of the changes
7e. If the changes are related to a specific issue or ticket, include the reference (e.g., "Fixes #123" or "Relates to JIRA-456") at the end of the commit message

8. Write a detailed explanation for each commit (separate from the commit message), walking through the changes in further detail as if explaining them to a reviewer.

Output your complete commit organization as a JSON array. Each commit in the array should be an object with the following properties:
- "message": A string containing the commit message
- "explanation": A string with a detailed explanation of the changes in the commit. Note that this is separate from the commit message and provides more detail than in the message itself.
- "hunks": An array of objects, each representing a hunk in the commit. Each hunk object should have:
  - "hunk": The hunk index (number) from the hunk_map

Write the JSON structure below inside a <output> tag and include no other text:
<output>
[
   {
      "message": "[commit message here]",
      "explanation": "[detailed explanation of changes here]",
      "hunks": [{"hunk": [index from hunk_map]}, {"hunk": [index from hunk_map]}]
   }
]
</output>

Remember:
- Text in [] brackets above should be replaced with your own text, not including the brackets
- Include all existing commits unchanged
- Organize all unassigned hunks into new commits
- Every hunk must be assigned to exactly one commit
- Base your organization on the actual code changes in the hunks

\${instructions}

Now, proceed with your analysis and organization of the commits. Return only the <output> tag and no other text.
`,
};

export const startWorkFromIssue: PromptTemplate<'start-work-issue'> = {
	id: 'start-work-issue',
	variables: ['issue', 'instructions'],
	template: `You are an advanced AI programming assistant tasked with helping a developer start work on a new issue. Your goal is to analyze the issue details and provide a clear plan of action, estimate, and implement a solution.

First, examine the following JSON object containing the issue details:

<issue>
\${issue}
</issue>

To effectively start work on this issue, follow these steps:

1. Carefully analyze the issue details, focusing on:
   - The problem statement and requirements
   - Any constraints or special considerations
   - The desired outcome or solution
2. Develop a clear plan of action that outlines the steps needed to address the issue
3. Provide an estimate of the time and resources required to complete the work
4. If applicable, implement a solution or provide code snippets that demonstrate how to address the issue

You can use GitKraken MCP tools to gather additional context about the repository and related issues/PRs.

\${instructions}

Now, proceed with your analysis and provide a clear plan of action, estimate, and implementation for the issue. Return only the relevant information without any additional text.`,
};

export const reviewPullRequest: PromptTemplate<'start-review-pullRequest'> = {
	id: 'start-review-pullRequest',
	variables: ['prData', 'instructions'],
	template: `You are an advanced AI programming assistant tasked with reviewing a pull request (PR). Your goal is to analyze the PR details and provide a comprehensive review that highlights strengths, identifies potential issues, and suggests improvements.

First, examine the following JSON object containing the PR details:

<prData>
\${prData}
</prData>

To effectively review this PR, follow these steps:

1. Carefully analyze the PR details, focusing on:
   - The problem statement and requirements
   - Any constraints or special considerations
   - The desired outcome or solution
2. Provide a detailed review that covers:
   - What the PR does well and why it is effective
   - Any potential issues or areas for improvement
   - Suggestions for how to address the issues or improve the PR

You can use GitKraken MCP tools to gather additional context about the repository and related issues/PRs.

\${instructions}

Now, proceed with your analysis and provide a comprehensive review of the PR. Return only the relevant information without any additional text.`,
};

export const reviewChanges: PromptTemplate<'review-changes'> = {
	id: 'review-changes',
	variables: ['diff', 'message', 'context', 'instructions'],
	template: `You are an expert code reviewer analyzing a set of code changes. Your goal is to identify meaningful issues — bugs, logic errors, security vulnerabilities, missing error handling, and potential regressions — while ignoring style preferences and linter-level concerns. Focus on problems a careful human reviewer would catch.

Examine the following code changes in Git diff format. Each non-header line inside a hunk has been annotated with its 1-based new-file line number in a \`[NNNNN]\` block placed immediately after the line-type marker (\` \`, \`+\`, or \`-\`):
  \` [   42] context line\`     // context: exists in both old and new; number = new-file line
  \`+[   43] added line\`        // added: only in new file; number = new-file line
  \`-[     ] removed line\`      // removed: not in new file; brackets are blank
  \`@@ -10,5 +12,7 @@ ...\`     // hunk header (no annotation; ignore for line citing)
<~~diff~~>
\${diff}
</~~diff~~>

Author's description of the changes:
<~~message~~>
\${message}
</~~message~~>

Related work items (known pull requests and issues for this change set). Use these for *intent*: what the change is trying to accomplish. They are not authoritative spec — if a finding contradicts the stated intent, flag it rather than defer to it. May be empty.
\${context}

Produce a structured review in the following XML format. Include ONLY the XML tags described — no other text:

<overview>
A concise 1-3 sentence summary of what these changes do and their overall quality. Note any systemic concerns.
</overview>
<focus-areas>
<area severity="critical|warning|suggestion" files="comma-separated file paths">
<label>Short title of the concern (under 60 chars)</label>
<rationale>Why this matters — what could go wrong or what is suboptimal</rationale>
<findings>
<finding severity="critical|warning|suggestion" file="path/to/file.ts" lines="start-end">
<title>Specific issue title</title>
<description>Clear explanation of the problem and how to address it</description>
</finding>
</findings>
</area>
</focus-areas>

Guidelines:
- Severity levels: "critical" = bugs, security issues, data loss risks; "warning" = logic concerns, missing error handling, potential regressions; "suggestion" = improvements, maintainability, performance
- Group related findings into focus areas by theme, not by file
- If changes look correct and well-structured, say so in the overview and include zero focus areas
- 3-5 high-quality findings are better than 15 low-quality ones
- For \`lines="start-end"\`, copy the numbers from the \`[NNNNN]\` annotations of the specific lines your finding concerns. Do not count, infer, or estimate — use only the annotated numbers. Removed lines (blank brackets \`[     ]\`) cannot be cited; pick the nearest surrounding new-file line instead. Anchor the range tightly to the lines the finding actually concerns; do not span an entire hunk.
- Do not flag style issues, naming preferences, or things a linter would catch
- Base conclusions only on the code shown — do not speculate about unseen code

\${instructions}

Review the changes and produce the structured XML output above.`,
};

export const reviewOverview: PromptTemplate<'review-overview'> = {
	id: 'review-overview',
	variables: ['files', 'message', 'context', 'instructions'],
	template: `You are an expert code reviewer performing an initial assessment of a set of code changes. You are given a file manifest (not full diffs) — use the file paths, change types, and line counts to identify which areas deserve closer inspection.

File manifest (JSON array of changed files):
<~~files~~>
\${files}
</~~files~~>

Author's description of the changes:
<~~message~~>
\${message}
</~~message~~>

Related work items (known pull requests and issues for this change set). Use these for *intent* — what the change is trying to accomplish — when ranking which areas deserve closer review. May be empty.
\${context}

Produce a structured assessment in the following XML format. Include ONLY the XML tags described — no other text:

<overview>
A concise 1-3 sentence summary of the scope and nature of these changes based on the file manifest and description.
</overview>
<focus-areas>
<area severity="critical|warning|suggestion" files="comma-separated file paths">
<label>Short title of the area to inspect (under 60 chars)</label>
<rationale>Why this area deserves closer review — based on the types of files changed, the volume of changes, and potential risk</rationale>
</area>
</focus-areas>

Guidelines:
- Severity reflects potential risk: "critical" = security-sensitive files, auth/crypto/payment paths, database migrations; "warning" = core logic changes, API changes, large modifications; "suggestion" = refactoring, config changes, documentation
- Rank focus areas from highest to lowest risk
- Group related files into focus areas by theme
- Include 2-6 focus areas. If changes are very simple, fewer is fine
- Do NOT include <findings> — those come in a later pass when full diffs are available

\${instructions}

Assess the changes and produce the structured XML output above.`,
};

export const addressReviewFindings: PromptTemplate<'address-review-findings'> = {
	id: 'address-review-findings',
	variables: ['reviewMarkdown', 'scopeLabel', 'granularity', 'instructions'],
	template: `You are an AI coding agent tasked with addressing the issues identified in a code review. Your goal is to understand each finding and, where appropriate, propose or make the code changes needed to fix it.

The review was performed against: \${scopeLabel}

The findings are provided as structured markdown below. Each finding includes a severity (\`**[CRITICAL]**\`, \`**[WARNING]**\`, or \`**[SUGGESTION]**\`), a short title, a description of the problem, and (when available) a file path and line range. Focus areas group related findings and include a rationale explaining why they matter.

<~~review~~>
\${reviewMarkdown}
</~~review~~>

Guidelines:
- Treat the findings as a working list. Prioritize critical issues, then warnings, then suggestions.
- For each finding, locate the referenced file(s) in the workspace before proposing a fix. If the file or line range no longer matches the review (the code may have evolved), reconcile against the current state.
- When making code changes, address the underlying problem the finding describes — do not just paper over symptoms.
- Prefer minimal, focused edits that don't introduce unrelated changes.
- If a finding is ambiguous, contradicts the surrounding code's intent, or is already addressed in the current state, say so explicitly rather than fabricating a fix.
- If a finding is out of scope (touches unrelated systems, requires significant refactoring, or contradicts established patterns), surface that as a tradeoff rather than acting on it.

\${instructions}`,
};

export const reviewDetail: PromptTemplate<'review-detail'> = {
	id: 'review-detail',
	variables: ['diff', 'overview', 'message', 'focusArea', 'context', 'instructions'],
	template: `You are an expert code reviewer performing a detailed inspection of specific files that were flagged for closer review. You have the context from an initial overview assessment.

Initial overview of the full changeset:
<~~overview~~>
\${overview}
</~~overview~~>

Focus area being inspected: \${focusArea}

Author's description of the changes:
<~~message~~>
\${message}
</~~message~~>

Related work items (known pull requests and issues for this change set). Use these for *intent* — what the change is trying to accomplish. They are not authoritative spec; if a finding contradicts the stated intent, flag it. May be empty.
\${context}

Code changes for the files in this focus area (Git diff format). Each non-header line inside a hunk has been annotated with its 1-based new-file line number in a \`[NNNNN]\` block placed immediately after the line-type marker (\` \`, \`+\`, or \`-\`):
  \` [   42] context line\`     // context: exists in both old and new; number = new-file line
  \`+[   43] added line\`        // added: only in new file; number = new-file line
  \`-[     ] removed line\`      // removed: not in new file; brackets are blank
  \`@@ -10,5 +12,7 @@ ...\`     // hunk header (no annotation; ignore for line citing)
<~~diff~~>
\${diff}
</~~diff~~>

Produce detailed findings in the following XML format. Include ONLY the XML tags — no other text:

<findings>
<finding severity="critical|warning|suggestion" file="path/to/file.ts" lines="start-end">
<title>Specific issue title</title>
<description>Clear explanation of the problem and how to address it</description>
</finding>
</findings>

Guidelines:
- Severity: "critical" = bugs, security, data loss; "warning" = logic concerns, error handling, regressions; "suggestion" = improvements, maintainability
- For \`lines="start-end"\`, copy the numbers from the \`[NNNNN]\` annotations of the specific lines your finding concerns. Do not count, infer, or estimate — use only the annotated numbers. Removed lines (blank brackets \`[     ]\`) cannot be cited; pick the nearest surrounding new-file line instead. Anchor the range tightly to the lines the finding actually concerns; do not span an entire hunk.
- Be concrete — explain what the problem is and how to fix it
- If the code in this area looks correct, return an empty <findings></findings> block
- Do not flag style issues or things a linter would catch

\${instructions}

Inspect the diff for this focus area and produce the structured XML findings above.`,
};
