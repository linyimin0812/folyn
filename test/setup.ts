import { beforeAll, beforeEach } from 'vitest';

import { __internals as fsInternals } from './mocks/@tauri-apps/plugin-fs';
import { __internals as pathInternals } from './mocks/@tauri-apps/api/path';
import { __internals as coreInternals } from './mocks/@tauri-apps/api/core';
import { __internals as eventInternals } from './mocks/@tauri-apps/api/event';
import { __internals as shellInternals } from './mocks/@tauri-apps/plugin-shell';
import { __internals as dialogInternals } from './mocks/@tauri-apps/plugin-dialog';

beforeAll(() => {
  // Mocks are installed via resolve.alias in vitest.workspace.ts; nothing to do here.
});

beforeEach(() => {
  fsInternals.reset();
  pathInternals.reset();
  coreInternals.reset();
  eventInternals.reset();
  shellInternals.reset();
  dialogInternals.reset();
});
