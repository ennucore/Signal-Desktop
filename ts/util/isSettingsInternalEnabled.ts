// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as RemoteConfig from '../RemoteConfig';
import { isNightly } from './version';

export function isSettingsInternalEnabled(): boolean {
  if (RemoteConfig.isEnabled('desktop.internalUser')) {
    return true;
  }

  const version = window.getVersion?.();
  if (version != null) {
    return isNightly(version);
  }

  return false;
}
