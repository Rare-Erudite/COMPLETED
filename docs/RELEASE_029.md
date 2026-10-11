# RARE 029

## Purpose
Correct the local Ollama structured-reasoning transport used by self-development.

## Changes
- Structured Ollama calls no longer force native `format: json`; RARE already validates and extracts JSON itself.
- Structured Ollama calls use a conservative 4096-token context default.
- Structured Ollama calls have a bounded 120-second HTTP timeout so a stalled local model cannot consume the entire global provider window.
- Regression coverage asserts the request shape and timeout.

This release does not claim physical Ollama execution has been certified in this environment; live Windows verification remains part of the user's test.
