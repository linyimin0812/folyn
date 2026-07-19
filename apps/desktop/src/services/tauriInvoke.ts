import { invoke as rawInvoke } from '@tauri-apps/api/core';
import i18n from '@/i18n';

/** Shape of a Rust `AppError` serialized via its custom Serialize impl
 *  (see src-tauri/src/errors.rs): `{ category, detail }`. */
export interface AppErrorShape {
  category: string;
  detail: string;
}

/**
 * Error thrown by `invoke` when the Rust command returns `AppError` (or any
 * rejection). Carries the stable `category` so callers can branch on the
 * error class without parsing strings; `translatedTitle` / `translatedMessage`
 * map to `rustErrors:<category>.{title,message}` keys.
 */
export class AppInvocationError extends Error {
  constructor(
    public readonly category: string,
    public readonly detail: string,
  ) {
    super(`${category}: ${detail}`);
    this.name = 'AppInvocationError';
  }

  translatedTitle(): string {
    return i18n.t(`rustErrors:${this.category}.title`) || this.category;
  }

  translatedMessage(): string {
    return (
      i18n.t(`rustErrors:${this.category}.message`, { detail: this.detail }) ||
      `${this.category}: ${this.detail}`
    );
  }
}

/**
 * Wrapper over Tauri's `invoke` that converts rejections into
 * `AppInvocationError`. Rejections shaped like `{category, detail}` (the
 * Rust `AppError` enum) keep their category; all other rejections collapse
 * to `category='internal'` with `detail=String(err)`.
 *
 * ponytail: this only wraps — call sites are NOT migrated here. Each
 * high-traffic user-visible error site can opt-in incrementally; until
 * then they keep using `@tauri-apps/api/core`'s `invoke` directly.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await rawInvoke<T>(cmd, args);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'category' in err &&
      'detail' in err
    ) {
      const { category, detail } = err as AppErrorShape;
      throw new AppInvocationError(String(category), String(detail));
    }
    throw new AppInvocationError('internal', String(err));
  }
}
