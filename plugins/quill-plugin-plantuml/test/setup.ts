// Test setup: assign the workspace's react instance to jsdom's window so
// plugin code (which uses window.React at runtime, not import 'react') can
// render under vitest. Mirrors what apps/desktop/src/main.tsx does at host
// boot.
import React from 'react';
import * as ReactDOM from 'react-dom';

Object.assign(window, { React, ReactDOM });
