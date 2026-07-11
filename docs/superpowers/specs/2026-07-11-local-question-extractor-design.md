# Local Question Extractor Design

## Goal

Upgrade page question detection from selector-first rules to a local, Firecrawl-inspired extraction pipeline. The feature stays fully local and does not call the Firecrawl API.

## Scope

This release adds structured question extraction for page content scripts:

- Clean noisy DOM regions before scoring.
- Find candidate question containers.
- Score candidates using structural and text evidence.
- Extract a normalized QuestionBlock.
- Keep adapter evidence for debugging.
- Preserve current Moodle behavior and keep legacy extraction as fallback during the transition.

This release does not add new remote services, login, cloud sync, or paid API behavior.

## Architecture

Content scripts load the extractor before the main content script.

- `question-normalizer.js`: shared text, visibility, selector, option, and evidence helpers.
- `question-adapters/moodle.js`: Moodle-specific extraction from `.que`, `.qtext`, and `.answer`.
- `question-adapters/generic-form.js`: fieldset, form, class/id, and input-driven extraction.
- `question-debug.js`: compact debug helpers for console and result metadata.
- `question-extractor.js`: runs adapters, dedupes overlapping candidates, and returns QuestionBlocks.

`content-script.js` remains responsible for scheduling scans, sending questions, and annotating answers.

## QuestionBlock

Each extracted question can include:

- `id`
- `questionText`
- `stemText`
- `type`
- `options`
- `multiple`
- `dedupeKey`
- `adapterName`
- `confidence`
- `containerSelector`
- `evidence`

The background worker can ignore unknown fields, so this remains backward compatible.

## Scoring

Positive signals include Moodle `.que`, `.qtext`, legend, radio/checkbox/input/textarea/select, 2-8 options, question-like class/id, reasonable text length, and visible area.

Negative signals include quiz navigation, timer, feedback, submit/button-heavy controls, hidden nodes, extension UI, too-short text, and very large text blocks.

## Testing

Add Node regression tests for:

- Moodle extraction.
- Generic radio question extraction.
- Noise filtering.
- Candidate deduplication.
- Metadata presence: adapter, confidence, selector, evidence.

Existing service worker, material retrieval, annotation, and scan scheduling tests must continue to pass.
