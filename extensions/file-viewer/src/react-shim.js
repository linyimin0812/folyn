/**
 * React shim — re-exports the host's `window.React` so a bundled dependency
 * (e.g. @file-viewer/react) that does `import React from 'react'` shares the
 * host's single React instance instead of bundling a second one.
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
