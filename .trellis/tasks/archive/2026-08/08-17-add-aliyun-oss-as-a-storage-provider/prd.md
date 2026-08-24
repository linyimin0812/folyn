# Add Aliyun OSS as a storage provider

## Goal

Add Aliyun (阿里云) OSS as a third storage provider alongside R2 and Qiniu — used by both the image-paste flow (image host) and the markdown→HTML share flow (HTML host). Follows the existing `StorageProvider` abstraction: one new file under `providers/`, one line in `registry.ts`, one form in `StorageSharingSettings.tsx`.

## What I already know

- The provider abstraction lives at `apps/desktop/src/services/storage/types.ts` (`StorageProvider` interface, discriminated `ProviderConfig` union).
- Adding a provider = new `OssProviderConfig` member + `providers/oss.ts` implementing `StorageProvider` + push to `registry.ts` array.
- Config persistence: `storageConfigStorage.ts` reads/writes `~/.folyn/image-hosts/<provider>.json` per id. The `loadFromDisk` loop currently hardcodes `['r2', 'qiniu']` — must add `'oss'`.
- `storageConfigStore.ts` has `defaultR2Config`/`defaultQiniuConfig` and `initialConfigs` map; must add `defaultOssConfig` + initial entry. `getActiveConfig` type guard must include `isOssConfig`.
- Settings UI: `StorageSharingSettings.tsx` switches on `isR2Config`/`isQiniuConfig` to render the form. Must add `isOssConfig` branch + `OssForm` component (mirrors R2Form/QiniuForm layout).
- CSP baseline (`utils/csp.ts`): must add `https://*.aliyuncs.com` to `img-src` (public bucket domain) and `connect-src` (PUT target).
- i18n: `settings:storage.provider.oss.label` + a `settings:storage.oss.*` block for fields + `publicHint`.
- Two signing schemes OSS supports: V1 (HMAC-SHA1, classic, simpler) and V4 (HMAC-SHA256, SigV4-style, newer). We already have `hmacSha1` (used by Qiniu) and `buildSigV4PutRequest` (used by R2) helpers in `crypto.ts`.

## Assumptions (temporary)

- **Signing scheme: V4 (HMAC-SHA256, SigV4-style).** Locked per user preference. Differs from AWS SigV4 in three material ways — see `research/oss-v4-signing.md`:
  1. Algorithm prefix `OSS4-HMAC-SHA256`, secret-key prefix `aliyun_v4`, scope suffix `aliyun_v4_request` (literal `_v` infix — not `OSS4`/`AWS4` and not `aliyun_request`).
  2. No `SignedHeaders=` field in the Authorization header — only `Credential=` + `Signature=`, with an optional `AdditionalHeaders=` for explicitly opted-in extras.
  3. Default signed header set excludes `host` and `content-length`. Body hash defaults to literal `UNSIGNED-PAYLOAD` (no `crypto.subtle.digest` needed). Simplest correct path: sign only `x-oss-date` + `x-oss-content-sha256` + `content-type`, set `x-oss-content-sha256: UNSIGNED-PAYLOAD`, let `fetch` set `host`/`content-length`.
- **Region normalization:** user enters `oss-cn-hangzhou` style in the form; we strip the `oss-` prefix for the V4 scope (`cn-hangzhou`) while keeping it in the endpoint hostname. Store the user-entered form verbatim in config; normalize at signing time.
- **Upload method: PUT object** (`PUT /<key>` with body bytes). Same shape as R2 PUT.
- **Endpoint shape: `https://<bucket>.<region>.aliyuncs.com/<key>`** (virtual-hosted-style). The `host` header is auto-set by `fetch`; not in the signed set.
- **CORS:** OSS bucket needs CORS rule allowing `tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`, methods PUT/GET/HEAD, headers authorization/content-type/x-oss-date/x-oss-content-sha256. Like R2, we surface a "copy CORS config" button in the form.
- **CSP wildcard `https://*.aliyuncs.com`** covers both upload endpoint and public access URL.
- **Upload method: PUT object** (`PUT /<bucket>/<key>` with body bytes). Same shape as R2 PUT. No multipart POST form upload (that's for browser-direct uploads where secretKey can't be exposed — not our case).
- **Endpoint shape: `https://<bucket>.<region>.aliyuncs.com/<key>`** (virtual-hosted-style). Region is free-form (e.g. `oss-cn-hangzhou`, `oss-us-west-1`). User enters region verbatim.
- **CORS:** OSS bucket needs CORS rule allowing `tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`, methods PUT/POST/GET/HEAD, headers authorization/content-type/x-oss-date/x-oss-content-sha256/date. Like R2, we surface a "copy CORS config" button in the form.
- **CSP wildcard `https://*.aliyuncs.com`** covers both upload endpoint and public access URL (bucket subdomain pattern). Broad but aliyuncs.com is Alibaba's domain — only used for image/script loading.

## Requirements (evolving)

- New `OssProviderConfig` interface with: `provider: 'oss'`, `accessKeyId`, `accessKeySecret`, `bucket`, `region`, `publicBaseUrl`, `imageKeyPrefix`, `htmlKeyPrefix`.
- `providers/oss.ts`: `OssProvider` class implementing `StorageProvider` — `capabilities = { image: true, html: true }`. `uploadImage`/`uploadHtml` build the V4-signed PUT request and return the public URL.
- New `buildOssV4PutRequest` helper in `crypto.ts` — V4 signature scheme. Sister function to `buildSigV4PutRequest`; same body-sha256 + signed-header layout but different scope suffix and credential string.
- `registry.ts`: register `new OssProvider()`.
- `storageConfigStore.ts`: `defaultOssConfig()` + `initialConfigs.oss` + `loadFromDisk` reads `oss.json` + `removeProviderConfig` resets to `defaultOssConfig()` + `getActiveConfig` accepts `isOssConfig`.
- `storageConfigStorage.ts`: hard-coded id list `['r2', 'qiniu']` → `['r2', 'qiniu', 'oss']`.
- `StorageSharingSettings.tsx`: new `OssForm` component + `isOssConfig(activeCfg)` branch.
- `utils/csp.ts`: `img-src` + `connect-src` baseline add `https://*.aliyuncs.com`.
- `zh/en settings.json`: `provider.oss.label` ("阿里云 OSS" / "Aliyun OSS") + `oss.accessKeyId`/`accessKeySecret`/`bucket`/`region`/`publicHint`.
- OSS CORS copy button (like R2) — reuses `settings:storage.cors.copyButton`/`.copied` keys; no new i18n needed.

## Acceptance Criteria (evolving)

- [ ] Selecting "Aliyun OSS" in the provider dropdown shows the OSS form with all fields.
- [ ] Saving a populated OSS config writes `~/.folyn/image-hosts/oss.json` and shows the ✓ saved toast.
- [ ] Pasting an image with OSS active uploads to OSS bucket and the returned URL renders in the markdown preview (CSP allows the aliyuncs.com URL).
- [ ] Share-to-cloud for markdown produces a public HTML URL on OSS.
- [ ] Share-to-cloud for source-only/image/svg file types produces a public URL on OSS.
- [ ] OSS bucket CORS preflight passes (rule surfaced via copy button in form).
- [ ] Unconfigured OSS provider shows "(未配置)" suffix in dropdown.

## Definition of Done

- Type check passes (no `any` casts at call sites).
- CSP test suite updated and passing (existing baseline-URL assertions).
- No new third-party SDK — pure fetch + crypto.subtle.
- Manual smoke: configure OSS, paste image, share markdown, share source file — all paths green.

## Out of Scope (explicit)

- STS temporary credentials (only long-lived AK/SK).
- OSS V1 signing (deferred; V4 chosen per user preference).
- Multipart upload for >5 MB files (single PUT covers images and HTML).
- Internal/endpoint region optimization (just use public endpoint).
- Pre-signed URL upload (we sign the PUT request directly).
- AdditionalHeaders opt-in (the default signed set is sufficient for our PUT use case).

## Technical Notes

- OSS V4 signing reference: https://www.alibabacloud.com/help/en/oss/developer-reference/signature-version-2 — full canonical request layout, scope format, worked examples in `research/oss-v4-signing.md`.
- Endpoint: `https://<bucket>.<region>.aliyuncs.com/<key>` (virtual-hosted). `host` header auto-set by `fetch`; not in signed set.
- Scope region normalization: `oss-cn-hangzhou` (user-entered) → `cn-hangzhou` (scope-only); endpoint hostname keeps the full `oss-` prefix.
- Self-check fixture: capture the worked PUT example from the OSS docs verbatim into `crypto.ts`'s dev self-check section. Same shape as the existing sha256/hmac-sha1 fixtures.

## Research References

- [`research/oss-v4-signing.md`](research/oss-v4-signing.md) — OSS V4 canonical request layout, scope/credential format, required headers, worked PUT example. Key deltas vs AWS SigV4: prefix `aliyun_v4` on secret, suffix `aliyun_v4_request` in scope, no `SignedHeaders=` field, default body hash is literal `UNSIGNED-PAYLOAD`.

## Open Questions

- (none — signing scheme V4 locked, all material deltas from research folded into Assumptions.)
