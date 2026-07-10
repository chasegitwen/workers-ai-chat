# OpenClaw Native Attachment Capability

## Summary

OpenClaw Native Attachment is a runtime capability, not a Bridge-only UI mode.
It allows Web AI Assistant to pass explicitly selected original files to an
OpenClaw runtime so OpenClaw can save, parse, and read the original attachment
for that run.

The first supported target is Hillsboro OpenClaw when its runtime registry entry
declares:

```json
{
  "capabilities": {
    "nativeAttachment": true
  }
}
```

Seattle OpenClaw remains on the legacy SSE transport:

```text
https://act.hnsnowground.cfd/v1/chat/completions
```

Seattle does not support this attachment capability in this release. Web AI
Assistant must not add OpenClaw WebChat-style `attachments[]` to Seattle
`/v1/chat/completions` requests.

## Protocol

The selected implementation for the Web AI Assistant side is direct base64
handoff from Worker to Bridge:

```text
Browser file selection
-> /api/files/upload stores original file in R2
-> Chat request with fileContextMode=native_attachment
-> Worker validates file record and scope
-> Worker reads the original R2 object
-> Worker sends Bridge task attachments with contentBase64
-> Bridge must call Gateway chat.send attachments[]
-> OpenClaw run reads the temporary inbound media
```

The Bridge service code is not in this repository. This repository now emits the
compatible task payload, but Bridge must independently consume it and translate
it to Gateway `chat.send`.

Worker to Bridge attachment shape:

```json
{
  "type": "file",
  "fileId": "file_xxx",
  "fileName": "paper.pdf",
  "mimeType": "application/pdf",
  "size": 123456,
  "contentBase64": "<base64>"
}
```

The same array is sent as both `attachments` and `native_attachments` for the
Bridge task. Legacy chunk-backed attachments remain in `files[]` and are not
used for native attachment mode.

## File Modes

Chat requests may specify:

```json
{
  "fileContextMode": "native_attachment",
  "attachmentFileIds": ["file_xxx"]
}
```

Supported modes are:

- `retrieval`: existing chunk retrieval behavior.
- `native_attachment`: original R2 object handoff for runtimes with
  `capabilities.nativeAttachment === true`.

Missing `fileContextMode` preserves existing retrieval behavior.

## Limits

Initial application-layer limits:

- Maximum attachments: 5
- Single non-image file: 6 MB
- Single image file: 4 MB
- Total raw selected files: 16 MB
- Estimated JSON/base64 payload: 24 MB

Estimated base64 length is calculated as:

```js
4 * Math.ceil(size / 3)
```

## Supported Types

Server-side allowlist:

- `image/*`
- `audio/*`
- `text/*`
- `application/pdf`
- `application/json`
- `application/zip`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.ms-excel`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/vnd.ms-powerpoint`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`

Video MIME types and common video extensions are rejected.

## Security

The server validates file records and uses server-side metadata for filename,
MIME, size, and R2 key. The frontend cannot supply trusted attachment metadata.

Current file records are scoped by `conversation_id`; if a file has a stored
conversation scope, native attachment preparation rejects requests from another
conversation. The current schema does not include `files.project_id`, so project
file scope is limited to existing conversation/project checks until a future
schema migration adds project-scoped files.

Logs must not include:

- base64 content
- raw document text
- secrets
- signed download URLs

Allowed observability fields include runtime id, transport, attachment count,
total byte count, estimated payload size, MIME types, Bridge task id, and
OpenClaw run id.

## Non-Goals

This release does not:

- implement Seattle native attachments
- fix chunk completeness
- persist long-term OpenClaw file IDs
- build an OpenClaw file library
- OCR documents
- modify OpenClaw Gateway, Cloudflare Access, or Nginx
- claim end-to-end native attachment completion until the Bridge service consumes
  `native_attachments`
