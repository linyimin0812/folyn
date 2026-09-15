/**
 * React shim — re-exports the host's `window.React` so the bundled config
 * form shares the host's single React instance instead of bundling a second
 * one (which would break hooks). The host sets window.React in main.tsx
 * before any trusted extension is import()-ed.
 */
const React = window.React;

export default React;

export const {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  useReducer,
  useContext,
  useSyncExternalStore,
  useId,
  useDeferredValue,
  useTransition,
  useImperativeHandle,
  useDebugValue,
  createContext,
  createElement,
  cloneElement,
  isValidElement,
  Children,
  Fragment,
  StrictMode,
  Suspense,
  forwardRef,
  memo,
  lazy,
  startTransition,
} = React;
