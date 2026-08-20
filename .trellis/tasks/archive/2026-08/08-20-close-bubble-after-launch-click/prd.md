# Close Pet Bubble After URL Launch Click

## Problem
`PetBubbleApp.tsx:264` keeps the bubble open for every `type === 'launch'` action, to let the main window emit `pet://bubble-authorize-request` back for un-whitelisted **app** launches. But **URL** launches never go through the authorize path (`handleLaunch` only emits authorize when `result.status === 'not_in_whitelist'`, which only happens for apps). So a URL launch leaves the bubble stuck open until TTL or ✕.

User-visible: clicking the "知道了" action (with `launch.type=url`) opens the browser but the bubble stays.

## Goal
Close the pet bubble immediately after a URL launch fires. Keep app launches open (authorize UI may render over the still-visible card).

## Scope
- Single file: `apps/desktop/src/components/pet/PetBubbleApp.tsx`
- No changes to `petHostRouter.ts` / `dispatch.rs` / payload contract.

## Non-Goals
- Closing the bubble after a *successful* whitelisted app launch — would require either a success signal from `open_external` or a timeout race. Separate change.
- Changing TTL behavior.
- Test payload changes (already ships `launch.type=url`).

## Implementation
In `fireAction` (`PetBubbleApp.tsx:264`), change the close guard:

```ts
// before
if (event.type !== 'launch') close();
// after
if (event.type !== 'launch' || event.launch?.type === 'url') close();
```

Update the preceding comment to note URL launches close (no authorize flow).

## Test
- Manual: settings → Pet External API → 测试 → click "知道了" → browser opens `https://example.com` AND bubble closes.
- Manual: app launch (e.g. `launch.type=app, value=Xcode`) on a non-whitelisted machine → bubble stays open, authorize UI renders. (Existing behavior preserved.)
- Existing `PetBubbleApp.test.tsx` should still pass (verify no regression).

## Risk
- If a future launch type needs the authorize-stays-open behavior (e.g. custom protocol handlers), the guard needs revisiting. Document via inline comment.
