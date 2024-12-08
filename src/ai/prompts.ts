export const generateCommitMessageSystemPrompt = `You are an advanced AI programming assistant`;
export const generateCommitMessageUserPrompt = `You are tasked with summarizing code changes into a concise but meaningful commit message. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative commit message that accurately represents the modifications made to the code.

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

Don't over explain and write your commit message summary inside <summary> tags and your commit message body inside <body> tags and include no other text.

Example format:
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

Now, based on the provided code diff and any additional context, create a concise but meaningful commit message following the instructions above.`;

export const generateCloudPatchMessageSystemPrompt = `You are an advanced AI programming assistant`;
export const generateCloudPatchMessageUserPrompt = `You are tasked with summarizing code changes into a concise and meaningful title and description. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative title and description that accurately represents the modifications made to the code.

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

Write your title inside <summary> tags and your description inside <body> tags and include no other text.

Example format:
<summary>
Implements user authentication feature
</summary>
<body>
Adds login and registration endpoints
Updates user model to include password hashing
Integrates JWT for secure token generation
</body>

\${instructions}

Now, based on the provided code diff and any additional context, create a concise but meaningful title and description following the instructions above.`;

export const generateCodeSuggestMessageSystemPrompt = `You are an advanced AI programming assistant`;
export const generateCodeSuggestMessageUserPrompt = `You are tasked with summarizing code changes into a concise and meaningful code review title and description. You will be provided with a code diff and optional additional context. Your goal is to analyze the changes and create a clear, informative code review title and description that accurately represents the modifications made to the code.

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

Write your title inside <summary> tags and your description inside <body> tags and include no other text.

Example format:
<summary>
Implements user authentication feature
</summary>
<body>
Adds login and registration endpoints
Updates user model to include password hashing
Integrates JWT for secure token generation
</body>

\${instructions}

Now, based on the provided code diff and any additional context, create a concise but meaningful code review title and description following the instructions above.`;

export const explainChangesSystemPrompt = `You are an advanced AI programming assistant`;
export const explainChangesUserPrompt = `You are tasked with creating clear, technical summaries of code changes that help reviewers understand the modifications and their implications. You will analyze a code diff and the author-provided message to produce a structured summary that captures the essential aspects of the changes.

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
