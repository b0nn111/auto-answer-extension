# Privacy Policy for 自动答题助手 (Auto Answer Helper)

**Last updated:** 2026-07-03

## Data Collection

This extension may process the following data from quiz or question pages:

- Question text detected on web pages
- Answer options detected on web pages
- Page URL where questions are detected

## How Data Is Used

The data is used only to provide the extension's answer-assistance features:

1. **Local question bank**: question-answer pairs are stored locally in the browser's IndexedDB.
2. **Free question-search source**: if the user enables the free search option, question text is sent to the configured public search endpoint.
3. **Local AI**: if the user configures a local AI service, question text is sent to that configured local endpoint.
4. **AI API**: if the user configures an API key and endpoint, question text is sent to that configured AI API.

## Data Storage

- Local question-answer pairs are stored in browser IndexedDB.
- The local database limit is 10,000 entries.
- Users can clear the local question bank from the settings page.
- API keys are stored in browser extension storage.

## Third-Party Data Sharing

This extension does not use analytics or tracking services.

Question text may be sent to third-party services only when the user explicitly enables or configures them:

- Free question-search endpoint, disabled by default
- User-configured cloud AI API

The current default free question-search endpoint is:

`https://study.jszkk.com/api/open/seek`

Users can disable this feature or change the endpoint in the settings page.

## User Control

- Enable or disable the extension from the popup.
- Enable or disable the free question-search source from the settings page.
- Configure or remove local AI and AI API settings.
- Clear all local question-bank data from the settings page.
- Uninstalling the extension removes local extension data.

## Accuracy Notice

Answers from local cache, public question-search sources, local AI, or AI APIs may be incomplete or incorrect. Users should verify results independently.

## Contact

If you have questions or suggestions, contact QQ: 3923636786.
