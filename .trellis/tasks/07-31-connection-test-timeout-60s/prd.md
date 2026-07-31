# Connection test timeout 60s

## Goal

Bump `testChatConnection` default `timeoutMs` from 10s to 60s. 10s was too tight for slower providers/regions (火山引擎 was hitting it after the history fix). The error message `${timeoutMs/1000} 秒超时` auto-updates from "10 秒超时" to "60 秒超时".

## Requirements

- `apps/desktop/src/services/rigChat.ts` `timeoutMs = 10000` → `60000`.

## Acceptance Criteria

- [ ] Default timeout is 60s; "60 秒超时" message reads correctly.

## Out of Scope

- Making timeout configurable per provider.
- Other changes to `testChatConnection`.
