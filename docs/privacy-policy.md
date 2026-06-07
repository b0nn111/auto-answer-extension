# Privacy Policy for 自动答题助手 (Auto Answer Helper)

**Last updated:** 2026-06-07

## Data Collection

This extension collects the following data from web pages you visit:

- **Question text**: Text content of questions detected on web pages
- **Page URLs**: The URL of the page where questions are detected

## How Data Is Used

The collected data is used solely to provide the core functionality of the extension:

1. **Local question bank**: Detected questions and their answers are stored locally in your browser's IndexedDB to enable faster responses on subsequent visits.
2. **AI processing**: Question text may be sent to:
   - A locally running AI service (e.g., Ollama, LM Studio) that you have configured
   - A cloud AI API (e.g., DeepSeek, OpenAI-compatible API) that you have explicitly configured with your own API key

## Data Storage

- All question-answer pairs are stored **locally** in your browser's IndexedDB.
- The local database never exceeds 10,000 entries.
- You can clear the entire local database at any time through the extension settings page.

## Data Sharing

This extension does **not** share your data with any third party, except:

- When **you explicitly configure** a cloud AI API (by providing your own API key), question text is sent to that API for processing.
- If you configure a local AI service, all data stays on your machine.

## User Control

- **Enable/Disable**: You can enable or disable the extension at any time via the popup toggle.
- **Clear data**: You can clear all locally stored question-answer pairs from the settings page.
- **Remove**: Uninstalling the extension removes all local data.

## Changes to This Policy

This privacy policy may be updated as the extension evolves. Changes will be reflected on this page.

## Contact

For questions about this privacy policy, please contact the extension developer through the support page.
