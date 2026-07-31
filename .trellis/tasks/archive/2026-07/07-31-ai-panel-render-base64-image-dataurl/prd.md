# AI Panel: Render base64 image data URL as image

## Problem

When an image model (e.g. via rig chat) returns the generated image as a
`data:image/png;base64,...` string in the assistant text content, the AI Panel
renders the raw base64 blob as plain text (or as a giant opaque markdown
paragraph) instead of displaying the image.

## Goal

When the assistant message content is *entirely* a `data:image/...;base64,...`
URL, render it as an `<img>` so the user sees the image. Non-image content
continues to flow through the existing markdown pipeline.

## Scope

- Touch only `apps/desktop/src/components/chat/MessageContent.tsx`.
- Detection: content (after `trim`) matches `^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$`.
- On match: render `<img src={content} alt="" />` with the same outer wrapper class.
- Streaming partial: while the model is still streaming base64 chunks, the
  content will not match the regex and falls through to the markdown path —
  acceptable (final state is correct).

## Out of scope

- Streaming-aware partial-image rendering (showing the image partway through).
- Multi-content messages (text + data URL in one message).
- Saving the generated image to vault / disk.
- Image-model detection at the provider layer (the panel treats any text
  content that looks like a data URL the same way).

## Acceptance

- A message whose `content` is a single `data:image/png;base64,...` URL renders
  as an inline image in the AI Panel.
- A message whose `content` is plain markdown still renders via markdown.
- A message whose `content` is partial base64 (mid-stream) renders as text
  until the URL is complete.
