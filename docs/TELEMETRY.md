# Telemetry: current behavior and future ingestion

## Current build

Ty-Code has no telemetry endpoint, HTTP sender, retry worker, or network-flush code. The opt-in checkbox records a narrow allowlist of event names locally only. Do not add a destination URL, implicit default endpoint, or background upload without a separate, explicit product decision and updated consent text.

- Consent is global and defaults to off.
- While consent is off, events are not written. Saving opt-out clears the encrypted local queue.
- Events are encrypted with Electron `safeStorage` and are not stored when the OS credential backend is unavailable or uses Linux `basic_text`.
- Queue storage is capped at 5 MiB. Oldest events are evicted first. Events older than 30 days are removed when the queue is loaded and when new events are recorded.
- The exact queued payload schema is `{"event":"app_started","timestamp":"<ISO-8601>"}` or `{"event":"feature_used","feature":"agent_chat|project_index|history_export","timestamp":"<ISO-8601>"}`. The transparency panel displays those exact JSON objects, supports copying and deleting events individually, and supports clearing the queue.
- No event is transmitted. The current delivery status is queued locally, sent 0, failed 0.

## Requirements before enabling a future endpoint

Any future implementation must be a separately reviewed change. Preserve opt-in consent and add a user-visible endpoint configuration with these constraints:

1. Accept absolute `https:` URLs only. Reject non-HTTPS schemes, URL credentials, invalid hostnames, and malformed URLs. Use normal platform TLS certificate verification; never set `rejectUnauthorized: false`, install an implicit custom CA, or continue after a certificate error. Do not follow cross-origin redirects.
2. Do not send anything unless consent is on and a valid endpoint has been explicitly configured. Show the exact serialized payload before enabling transmission. Keep credentials, source code, prompts, paths, filenames, identifiers, and raw stack traces out of payloads.
3. Send only the local allowlisted events. Bound request size and timeouts. Retry a failed event with exponential backoff (for example 1s, 2s, 4s); after three failed delivery attempts, discard it and increment the failed counter. Never retry indefinitely.
4. Display queued, sent, and failed counts in the transparency view. Provide a user action to pause delivery and clear all queued data. Retain the 5 MiB cap and 30-day age limit.
5. Add tests for consent-off behavior, TLS and invalid certificate failure, redirects, retries, retry exhaustion, payload redaction, queue limits, and opt-out purging. Update the in-app privacy policy and this document before shipping any sender.

## Optional self-hosted ingestion for a future release

No endpoint is deployed or configured today. If Ty-Code later adopts telemetry, a privacy-reviewed option is a small Cloudflare Worker that validates the fixed event schema and writes to a Cloudflare D1 database or Analytics Engine. A self-hosted Umami or Plausible instance is another option, but both must be evaluated to ensure custom event payloads, retention, and IP/log handling match Ty-Code's disclosure. Free-tier limits and terms change; operators must verify current pricing, quotas, data residency, access control, retention, and deletion behavior before deployment. The application must not assume a marketing website on Cloudflare Pages means telemetry may be sent.

Deployment checklist:

- Publish an HTTPS-only ingestion endpoint with certificate renewal and access controls.
- Document exactly which event fields are accepted, retention duration, deletion procedure, and server-side logs.
- Set quotas and rate limits; reject unknown fields and oversized request bodies.
- Provide an endpoint URL to the application only after explicit user consent and a reviewed configuration path are implemented.
- Validate certificate failures and ensure the client rejects cross-origin redirects.
- Review the Privacy & About copy and publish the endpoint operator/contact details before release.
