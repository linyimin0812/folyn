# Prevent Markdown image resize past its maximum width

## Problem

When a user drags a Markdown preview image's resize handle beyond the preview
container width, the persisted width can exceed the rendered maximum. Because
the media wrapper is centered, this makes the image appear to shift left.

## Requirements

- Clamp each drag update to the preview container's available width.
- Once the media is at that width, further rightward dragging must not change
  its width or position.
- Keep leftward shrinking and width persistence unchanged.
- Add a regression test for a resize started at the maximum width.

## Acceptance criteria

- A media item whose rendered width equals its container width remains fixed
  when its resize handle is dragged right.
- A media item below the maximum grows only up to the container width.
- A drag left from either state still decreases the width.
