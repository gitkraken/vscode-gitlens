export const generateCommitMessageUserPrompt = `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise but meaningful commit message. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative commit message that accurately represents the modifications made to the code.

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
   - Focus on the "why" rather than the "what" of the changes.
5. If the changes are related to a specific issue or ticket, include the reference (e.g., "Fixes #123" or "Relates to JIRA-456") at the end of the commit message.

Don't over explain and write your commit message summary inside <summary> tags and your commit message body inside <body> tags and include no other text:

<summary>
Implements user authentication feature
</summary>
<body>
Adds login and registration endpoints
Updates user model to include password hashing
Integrates JWT for secure token generation

Fixes #789
</body>

\${instructions}

Based on the provided code diff and any additional context, create a concise but meaningful commit message following the instructions above.`;

export const generatePullRequestMessageUserPrompt = `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise but meaningful pull request title and description. You will be provided with a code diff and a list of commits. Your goal is to analyze the changes and create a clear, informative title and description that accurately represents the modifications made to the code.
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
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the title of your pull request message
   - Start with a third-person singular present tense verb
   - Limit to 50 characters if possible
4. If necessary, provide a brief explanation of the changes, which will be the body of your pull request message
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes.
   - Structure the body with markdown bullets and headings for clarity
5. If the changes are related to a specific issue or ticket, include the reference (e.g., "Fixes #123" or "Relates to JIRA-456") at the end of the pull request message.

Write your title inside <summary> tags and your description inside <body> tags and include no other text:

<summary>
Implements user authentication feature
</summary>
<body>
Adds login and registration endpoints:
- Updates user model to include password hashing
- Integrates JWT for secure token generation

Fixes #789
</body>
\${instructions}

Based on the provided code diff, commit list, and any additional context, create a concise but meaningful pull request title and body following the instructions above.`;

export const generateStashMessageUserPrompt = `You are an advanced AI programming assistant and are tasked with creating a concise but descriptive stash message. You will be provided with a code diff of uncommitted changes. Your goal is to analyze the changes and create a clear, single-line stash message that accurately represents the work in progress being stashed.

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

Write your stash message inside <summary> tags and include no other text:

<summary>
Adds new awesome feature
</summary>

\${instructions}

Based on the provided code diff, create a concise but descriptive stash message following the instructions above.`;

export const generateCloudPatchMessageUserPrompt = `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise and meaningful title and description. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative title and description that accurately represents the modifications made to the code.

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
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the title.
4. If necessary, provide a brief explanation of the changes, which will be the description.
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes.

Write your title inside <summary> tags and your description inside <body> tags and include no other text:

<summary>
Implements user authentication feature
</summary>
<body>
Adds login and registration endpoints
Updates user model to include password hashing
Integrates JWT for secure token generation
</body>

\${instructions}

Based on the provided code diff and any additional context, create a concise but meaningful title and description following the instructions above.`;

export const generateCodeSuggestMessageUserPrompt = `You are an advanced AI programming assistant and are tasked with summarizing code changes into a concise and meaningful code review title and description. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative code review title and description that accurately represents the modifications made to the code.

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
3. Summarize the main purpose of the changes in a single, concise sentence, which will be the title.
4. If necessary, provide a brief explanation of the changes, which will be the description.
   - Add line breaks for readability and to separate independent ideas
   - Focus on the "why" rather than the "what" of the changes.

Write your title inside <summary> tags and your description inside <body> tags and include no other text:

<summary>
Implements user authentication feature
</summary>
<body>
Adds login and registration endpoints
Updates user model to include password hashing
Integrates JWT for secure token generation
</body>

\${instructions}

Based on the provided code diff and any additional context, create a concise but meaningful code review title and description following the instructions above.`;

export const explainChangesUserPrompt = `You are an advanced AI programming assistant and are tasked with creating clear, technical summaries of code changes that help reviewers understand the modifications and their implications. You will analyze a code diff and the author-provided message to produce a structured summary that captures the essential aspects of the changes.

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

Based on the provided code diff and message, create a focused technical summary following the format above.`;

export const generateChangelogUserPrompt = `You are an expert at creating changelogs in the "Keep a Changelog" format (https://keepachangelog.com). Your task is to create a set of clear, informative changelog entries.

First, carefully examine the following JSON data containing commit messages and associated issues. The data is structured as an array of "change" objects. Each "change" contains a \`message\` (the commit message) and an \`issues\` array. The \`issues\` array contains objects representing associated issues, each with an \`id\`, \`url\`, and optional \`title\`.

<~~data~~>
\${data}
</~~data~~>

Guidelines for creating the changelog:

1. Analyze the commit messages and associated issue titles (if available) to understand the changes made. Be sure to read every commit message and associated issue titles to understand the purpose of each change.
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
7. Provide only the changelog entry—no additional text or commentary outside of the changelog

Example output structure:

### Added
- Adds brief description of the added feature ([#Issue-ID](Issue-URL))

### Changed
- Changes brief description of how something changed ([#Issue-ID](Issue-URL))
- Improves brief description of how something improved ([#Issue-ID](Issue-URL))

### Fixed
- Fixes Issue Title or brief description if no title ([#Issue-ID](Issue-URL))

\${instructions}

Based on the provided commit messages and associated issues, create a set of markdown changelog entries following the instructions above. Do not include any explanatory text or metadata`;

export const generateRebaseUserPrompt = `You are an advanced AI programming assistant tasked with reoriginizing a set of commit changes, provided in a unified diff format, into a new set of commits with the changes grouped both logically and atomically and should be easy to review. The changes should only be reorganized at the hunk level, not as individual lines, and no other changes should be made. You will be provided the unified diff of code changes, a list of commits with their commit message and associated diffs, and optional additional context.

First, examine the following unified Git diff of code changes:
<~~diff~~>
\${diff}
</~~diff~~>

Then, review the list of commits and their code changes/diffs to help understand the motivation behind the original commit history and any relevant background information:
<~~commits~~>
\${commits}
</~~commits~~>

Now, if provided, use this context to understand the motivation behind the changes and any relevant background information:
<~~additional-context~~>
\${context}
</~~additional-context~~>

Guidelines for reorganizing the commit history:

1. Carefully review the unified diff changes, all the commit messages and associated diffs to understand the original set of changes and how that could be reorganized better.
2. Using that understanding, generate a new set of commits that represents the same changes:
   - Only reorganize the hunks, not the lines within the hunks
   - Grouped into logical units that make sense together and can be applied atomically
   - Ensures that each commit is self-contained and does not depend on other commits, unless that commit comes after the commit it depends on
   - Uses meaningful commit messages that accurately describe the changes in each commit
   - Provides a detailed explanation of the changes in each commit
   - Ensures that the new commit history is easy to review and understand
3. Ensure that the new commit history is equivalent to the original commit history. That is, if all the new commits were squashed into a single commit, the diff of the combined changes should be exactly equivalent to the diff of combined changes you received as input.
4. Output the new commit history you have generated as JSON, using the following JSON schema:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "A commit message that describes the changes"
      },
      "explanation": {
        "type": "string",
        "description": "A detailed explanation of the changes in the commit"
      },
      "hunks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "hunk": {
              "type": "string",
              "description": "hunk header line for the specific hunk"
            },
            "diff": {
              "type": "string",
              "description": "diff header line for the file that contains this hunk"
            }
          },
          "required": ["diff", "hunk"],
          "additionalProperties": false
        }
      }
    },
    "required": ["message", "explanation", "hunks"],
    "additionalProperties": false
  }
}
5. Ensure that the \`hunk\` property is just the hunk header line (NOT the full hunk) for the specific hunk in the unified diff, and the \`diff\` property is the diff header line for the file that contains that hunk, also from the unified diff.

Example ouput JSON:
[{
  "message": "Fixes typo in README.md",
  "explanation": "This commit fixes a typo in the README file on the word 'repository'.",
  "hunks": [{ "diff": "diff --git a/README.md b/README.md", "hunk": "@@ -11,6 +11,10 @@" }]
},
{
  "message": "Adds new feature to AI provider service",
  "explanation": "This commit adds a new feature to the AI provider service that allows users to switch between different AI models.",
  "hunks": [
    { "diff": "diff --git a/src/plus/ai/aiProviderService.ts b/src/plus/ai/aiProviderService.ts", "hunk": "@@ -11,6 +11,10 @@" },
    { "diff": "diff --git a/CHANGELOG.md b/CHANGELOG.md", "hunk": "@@ -11,6 +11,10 @@" }
  ]
}]

\${instructions}

Based on the provided instructions above output only JSON and nothing else.`;

export const generateRebaseUserPromptV2 = `You are an advanced AI programming assistant tasked with reorganizing a set of commit changes. Your goal is to create a new set of commits that are related, grouped logically, atomic, and easy to review. You will be working with code changes provided in a unified diff format.

First, examine the following unified Git diff of code changes within each hunk:

<unified_diff>
\${diff}
</unified_diff>

Next, review this list of original commits, including their commit messages and associated diffs. This will help you understand the motivation behind the original commit history:

<commit_list>
\${commits}
</commit_list>

If provided, use the following additional context to better understand the motivation behind the changes and any relevant background information:

<additional_context>
\${context}
</additional_context>

Your task is to reorganize these changes into a new set of commits. Follow these guidelines:

1. Only reorganize at the hunk level, not individual lines within hunks.
2. Group changes into logical units that make sense together and can be applied atomically.
3. Ensure each commit is self-contained and only depends on commits that come before it in the new history.
4. Write meaningful commit messages that accurately describe the changes in each commit.
5. Provide a detailed explanation of the changes in each commit.
6. Make sure the new commit history is easy to review and understand.
7. Verify that the new commit history is equivalent to the original. If all new commits were squashed, the resulting diff should match the input diff exactly.

Output your new commit history as a JSON array. Each commit in the array should be an object with the following properties:
- "message": A string containing the commit message.
- "explanation": A string with a detailed explanation of the changes.
- "hunks": An array of objects, each representing a hunk in the commit. Each hunk object should have:
  - "hunk": The hunk header line from the unified diff.
  - "diff": The diff header line for the file containing the hunk.

Once you've completed your analysis, generate the JSON output following the specified format. Ensure that you only include the hunk header line in the "hunk" property and the diff header line in the "diff" property.

Here's an example of the expected JSON structure (note that this is just a structural example and does not reflect the actual content you should produce):

[
  {
    "message": "Example commit message",
    "explanation": "Detailed explanation of the changes in this commit",
    "hunks": [
      {
        "diff": "diff --git a/example/file.txt b/example/file.txt",
        "hunk": "@@ -1,5 +1,5 @@"
      }
    ]
  }
]

Remember to base your reorganization solely on the provided unified diff, commit list, and additional context. Do not introduce any new changes or modify the content of the hunks. Your task is to reorganize the existing changes in a more logical and reviewable manner.

\${instructions}

Now, proceed with your analysis and reorganization of the commits. Output only the JSON array containing the reorganized commits, and nothing else.`;

export const generateRebaseUserPromptV3 = `You are an advanced AI programming assistant tasked with organizing code changes into commits. Your goal is to create a new set of commits that are related, grouped logically, atomic, and easy to review. You will be working with code changes provided in a unified diff format.

First, examine the following unified Git diff of code changes:

<unified_diff>
\${diff}
</unified_diff>

Next, examine the following JSON array which represents a mapping of index to hunk headers in the unified_diff to be used later when mapping hunks to commits:
<hunk_map>
\${data}
</hunk_map>


Your task is to group the hunks in unified_diff into a set of commits, ordered into a commit history as an array. Follow these guidelines:

1. Only organize the hunks themselves, not individual lines within hunks.
2. Group hunks into logical units that make sense together and can be applied atomically.
3. Ensure each commit is self-contained and only depends on commits that come before it in the new history.
4. Write meaningful commit messages that accurately describe the changes in each commit.
5. Provide a detailed explanation of the changes in each commit.
6. Make sure the new commit history is easy to review and understand.

Output your new commit history as a JSON array. Each commit in the array should be an object representing a grouping of hunks forming that commit, with the following properties:
- "message": A string containing the commit message.
- "explanation": A string with a detailed explanation of the changes in the commit.
- "hunks": An array of objects, each representing a hunk in the commit. Each hunk object should have:
  - "hunk": The hunk index (number) from the hunk_map, matching the equivalent hunk you chose from the unified_diff.

Once you've completed your analysis, generate the JSON output following the specified format.

Here's an example of the expected JSON structure (note that this is just a structural example and does not reflect the actual content you should produce):

[
  {
    "message": "Example commit message",
    "explanation": "Detailed explanation of the changes in this commit",
    "hunks": [
      {
        "hunk": 2
      },
      {
        "hunk": 7
      }
    ]
  }
]

Remember to base your organization of commits solely on the provided unified_diff and hunk_map. Do not introduce any new changes or modify the content of the hunks. Your task is to organize the existing hunks in a logical and reviewable manner.

\${instructions}

Now, proceed with your analysis and organization of the commits. Output only the JSON array containing the commits, and nothing else.`;
