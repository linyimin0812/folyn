# Board calendar sticky z-index fix

## Goal

In Board view, horizontally scrolling the board columns left causes the columns to paint over the sticky DayCalAside (left calendar sidebar). Fix by giving the sticky daycal a z-index.

## Root cause

`.sw-board-daycal` (index.css:975) has `position: sticky; left: 0;` but no `z-index`. `.sw-board` (index.css:997) — which contains the columns — comes after daycal in DOM order inside `.sw-board-layout`. With no z-index on either, paint order follows DOM: later-painted `.sw-board` columns render on top of the sticky daycal during horizontal scroll.

## Fix

Add `z-index: 1` to `.sw-board-daycal`. One-line CSS change.

## Acceptance Criteria

- [ ] Horizontally scrolling the board columns left keeps the DayCalAside visible on top of the columns (not occluded).

## Out of Scope

- Vertical scroll behavior.
- Any column width / layout changes.

## Technical Notes

- File: `apps/desktop/src/index.css:975` (`.sw-board-daycal`).
