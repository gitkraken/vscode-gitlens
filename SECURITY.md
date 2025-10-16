# Security Policy

We take the security of this project seriously and appreciate responsible disclosures from the community.

## Reporting a vulnerability

Please do not open public issues for security vulnerabilities.

- Use GitHub's private vulnerability reporting for this repository: https://github.com/gitkraken/vscode-gitlens/security/advisories/new
- Include a clear description, reproduction steps or proof-of-concept, affected versions, and the potential impact.

### Our response SLAs

- Acknowledgement: within 3 business days
- Triage and initial assessment: within 7 calendar days
- Status updates: at least weekly until resolution
- Fix timeline: prioritized by severity and impact; critical issues are addressed as quickly as possible and may result in an out-of-cycle release

### Coordinated disclosure

We follow a coordinated disclosure process. We ask researchers to refrain from public disclosure for up to 90 days (or until a fix is released, whichever comes first). We will credit researchers who responsibly report qualifying issues, if attribution is requested.

### Safe harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to comply with this policy
- Avoid privacy violations, data destruction, or service degradation
- Only test against accounts and systems they own or have explicit permission to test
- Give us reasonable time to remediate before public disclosure

Activities that are out of scope include denial-of-service, spam, social engineering, physical attacks, and automated scanning that degrades service.

## Supported versions

Security fixes are provided for the following versions:

| Release channel | Supported |
| --------------- | --------- |
| Latest stable (current Marketplace release) | Yes |
| Previous stable (prior Marketplace release) | Best-effort for critical fixes, for 90 days |
| Older releases and pre-releases | No |

We generally do not backport non-critical fixes.

## Additional notes

- This repository uses automated code scanning (e.g., CodeQL) as part of our CI to detect certain classes of vulnerabilities early.
- For non-security bugs, please use the issue tracker: https://github.com/gitkraken/vscode-gitlens/issues
