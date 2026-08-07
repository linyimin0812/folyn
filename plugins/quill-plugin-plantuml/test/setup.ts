// Test setup: assign the workspace's react instance to jsdom's window so
// plugin code (which uses window.React at runtime, not import 'react') can
// render under vitest. Mirrors what apps/desktop/src/main.tsx does at host
// boot. Also assigns window.codemirrorLanguage so plantumlLanguage.ts
// (which calls resolveCodemirror() at module load) can resolve the host's
// @codemirror/language instance.
import React from 'react';
import * as ReactDOM from 'react-dom';
import * as cmLanguage from '@codemirror/language';

Object.assign(window, { React, ReactDOM, codemirrorLanguage: cmLanguage });
