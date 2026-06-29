/**
 * Bridge between the command palette's "AI 规划今日" action and the
 * ScheduleWorkbench's plan-my-day flow.
 *
 * The ScheduleWorkbenchPage owns the plan UI state (loading / preview / error).
 * The command palette runs commands outside React (imperatively, via
 * `getState()`), so it cannot call the page's hooks directly. This tiny module
 * holds a stable starter function registered by the ScheduleWorkbenchPage on
 * mount and invoked by the palette's `action.plan-my-day` command.
 *
 * Mount-race handling mirrors `newItemBridge`: if a request arrives before the
 * workbench has mounted (e.g. the palette switched `currentPage` to 'schedule'
 * and the page hasn't rendered yet), the request is queued and replayed on
 * mount.
 */

type Starter = () => void;

let starter: Starter | null = null;
let pending = false;

/**
 * Register the workbench's plan-my-day starter. Called on mount; cleared on
 * unmount. Fulfills any request that arrived while the workbench was not
 * mounted.
 */
export function setPlanMyDayStarter(fn: Starter | null): void {
  starter = fn;
  if (fn && pending) {
    pending = false;
    fn();
  }
}

/**
 * Request that the ScheduleWorkbench begin the plan-my-day flow. If the
 * workbench is not mounted, the request is queued and replayed when it mounts.
 */
export function requestPlanMyDay(): void {
  if (starter) {
    starter();
  } else {
    pending = true;
  }
}

/** Test helper: reset the bridge to its initial state. */
export function resetPlanMyDayBridge(): void {
  starter = null;
  pending = false;
}
