# Research: End-to-End Encryption for Vault Sync

- **Query**: What's the right E2E encryption scheme for a local-first app syncing files to S3-compatible / WebDAV object storage, where the remote must never see plaintext?
- **Scope**: mixed (external scheme survey + internal Quill mapping)
- **Date**: 2026-07-05

## TL;DR Recommendation for Quill

- **Cipher**: AES-256-GCM via WebCrypto `SubtleCrypto` in the renderer. Nonce = 12 random bytes per file-version, stored in the header.
- **KDF**: PBKDF2-SHA256, **≥ 600,000 iterations** (OWASP 2023 guidance for PBKDF2-SHA256), 16-byte random salt per vault, also derived/stored in the header. This is the only KDF natively available in WebCrypto without pulling in Rust/wasm. Argon2id is strictly better but requires Rust — keep as a documented future upgrade.
- **Key model**: Envelope encryption. A per-vault **master key** (256-bit random, generated once and stored locally wrapped by the passphrase-derived KEK) plus a **per-file random data key (DEK)** that is encrypted by the master key and shipped *inside* the remote object header. Master key never leaves the device in plaintext; only the wrapped form is uploaded so other devices can bootstrap.
- **Multi-device key flow**: device B enters the same passphrase → derives same KEK from (salt + iterations, both stored on the remote in a `keywrap` object) → fetches the wrapped master key blob from the remote → unwraps → uses master key to decrypt per-file DEKs. Effectively the Cryptomator model.
- **File layout on remote**: a small binary header `[magic|version|kdf_params|wrappedDEK|nonce]` followed by ciphertext. Equivalent to Cryptomator's `.c9r` file (per-file dir containing `masterkey.cryptomator`-style header + content).
- **Binary vs text**: No difference. AES-GCM operates on bytes; the file's bytes (text or image) are encrypted as-is. The only caveat is streaming/large-file memory, but for a Markdown+images vault, whole-file in memory is fine for MVP.
- **Re-encryption on edit**: Whole-file re-encrypt with a fresh nonce + fresh DEK. Range/CTR-based partial updates are explicitly out of scope for MVP.
- **Rust vs renderer split**: Keep *all* crypto in the renderer via WebCrypto. Use Rust (`src-tauri`) only for (a) large-file streaming encryption if/when needed later, (b) Argon2id upgrade, (c) secure local storage of the wrapped master key via OS keychain (a future task). For MVP, the wrapped master key can live in `localStorage`/settings sidecar — document this as a known weakness.

---

## Findings

### 1. Envelope Encryption vs Direct Key Use

**Direct key use** = derive one key from the passphrase and use it to encrypt every file directly.

Problems:
- Changing the passphrase requires re-encrypting *every file* on the remote (re-derive → re-encrypt all objects). For a vault with thousands of files this is expensive and a multi-device coordination headache.
- Per-file key isolation is lost — a single nonce reuse or key leak compromises everything.
- Can't easily support "per-file random key" properties needed for forward secrecy within the vault.

**Envelope encryption** = two layers:
- A **Key Encryption Key (KEK)** derived from the user passphrase (slow KDF).
- A **Data Encryption Key (DEK)** = 256 random bits, generated *per file* (or per file-version). The DEK encrypts the file content with AES-GCM; the KEK encrypts the DEK; the encrypted DEK (wrapped key) is stored alongside the ciphertext.

Why it's the standard (used by AWS KMS, GCP KMS, Cryptomator, age, Tailscale's tailfs):
- Passphrase rotation only re-wraps the (small) DEKs / master key, not the (large) file content. With a *master key* layer it's even cheaper: passphrase rotation re-wraps the single master key, and every per-file DEK stays valid.
- Per-file DEK gives crypto compartmentalization: compromising one file's DEK doesn't reveal others.
- The slow KDF (PBKDF2/Argon2) only runs once per session to derive the KEK; per-file encryption uses the fast raw AES-GCM of a random key — fast and avoids re-running the KDF per file.
- Master key (random, not derived) is the *real* long-term secret; the passphrase only protects the master key. This is the Cryptomator `masterkey.cryptomator` model.

**Recommended Quill model** (3-tier, Cryptomator-style):
1. KEK = PBKDF2(passphrase, salt, iters) → 256-bit.
2. Master key = 256 random bits, generated once per vault, stored locally + uploaded *wrapped* by KEK.
3. DEK = 256 random bits per file-version, encrypted by master key, shipped in the object header.

This gives: passphrase change = re-wrap master key only (one object). Master-key compromise (rare) = re-wrap all DEKs. Per-file compromise = only one file.

### 2. KDF Choice in a Tauri 2 (Rust + Webview) Renderer

The renderer is a webview, so it has the standard **WebCrypto `SubtleCrypto`** API. Available algorithms (per W3C WebCrypto spec, confirmed across Chromium/WebKit/webview2):
- `PBKDF2` (with SHA-1/SHA-256/SHA-384/SHA-512 PRFs) — **natively available**.
- `HKDF` — available.
- Argon2 — **NOT in WebCrypto**. Needs a Rust binding (e.g. `argon2` crate) called via `invoke`, or a wasm package (e.g. `hash-wasm`).
- scrypt — **NOT in WebCrypto**. Same options as Argon2.

**Iteration guidance (OWASP Password Storage Cheat Sheet, 2023):**
- PBKDF2-SHA256: ≥ **600,000** iterations.
- PBKDF2-SHA512: ≥ 210,000.
- (For comparison: Argon2id t=2, m=19456 KiB, p=1 — but not natively available here.)

Obsidian Sync / Cryptomator references (from public docs, may be stale — verify version):
- Cryptomator uses **scrypt** (N=2^15, r=8, p=1 historically) for `masterkey.cryptomator`, and **HKDF-SHA256** for per-file keys.
- Obsidian Sync uses AES-256-GCM with a key derived from the user's Obsidian account / a recovery password; their docs emphasize E2E but do not publish exact KDF params.
- Standard Notes uses **AES-256-GCM** with keys derived via PBKDF2-SHA512 (historically 100k+ iterations) over an account password; the ECIES-style "shared vault" item protocol for sharing.

**Salt handling**: 16-byte cryptographically random salt, generated once per vault, stored in plaintext on the remote (in the keywrap object). The salt's job is to make the KDF output vault-specific; it is not secret.

**Recommendation for Quill**: PBKDF2-SHA256, 600k iterations, 16-byte salt. All in renderer via `crypto.subtle.deriveKey`. ~1-2s on a typical laptop at 600k — acceptable for a once-per-session unlock. If unacceptable, move Argon2id to Rust as a fast tracked upgrade (Argon2id t=3, m=64MiB is also ~1s and is the modern preferred KDF).

### 3. Symmetric Cipher: AES-GCM vs ChaCha20-Poly1305

| | AES-GCM | ChaCha20-Poly1305 |
|---|---|---|
| WebCrypto native | **Yes** (`AES-GCM`, 128/192/256-bit) | No |
| Rust crate | `aes-gcm` | `chacha20poly1305` |
| Hardware accel | AES-NI on x86, ARMv8 crypto on Apple | Constant-time SW, fast without accel |
| Nonce length | 96 bits (12 bytes) standard | 96 bits (12 bytes) or 64 bits |
| Nonce reuse | catastrophic (recovers plaintext, forges tags) | catastrophic |
| Key size | 256 recommended | 256 |

**In a Tauri webview the renderer has hardware-accelerated AES via the platform's SubtleCrypto (WebKit on macOS uses ARMv8 crypto; WebView2 uses AES-NI).** ChaCha would require pulling the cipher into Rust or wasm — extra surface for MVP.

**Nonce/IV generation**: 12 random bytes from `crypto.getRandomValues(new Uint8Array(12))` per *encryption* (= per file-version write). **Never reuse a nonce with the same key.** Because we generate a fresh random DEK per file-version, even a nonce collision across files is harmless (different keys). Within the same file's history, each version gets a new DEK *and* a new nonce — double safety. Store the nonce in the header in plaintext (it is not secret).

Some schemes (e.g. AES-GCM with a counter nonce + persistent key) require careful counter management to avoid reuse — random nonces with per-file DEKs sidestep this entirely, which is why envelope + random nonce is the robust MVP choice.

**Recommendation**: AES-256-GCM via WebCrypto. Whole-file `encrypt`/`decrypt` calls.

### 4. File Format / Remote Object Layout

Two viable layouts:

**(A) Single-object, header + ciphertext** (simplest; recommended for MVP):
```
[magic 4B = "QENC"]
[version 1B]
[flags 1B]
[kdf_algo 1B] [kdf_iters 4B BE] [kdf_salt 16B]
[wrappedDEK_len 2B BE] [wrappedDEK (48B for AES-256-GCM of a 32B key)]
[nonce 12B]
[ciphertext ...]
[auth_tag 16B]   // AES-GCM tag, appended by WebCrypto
```
WebCrypto's `aes-gcm` `encrypt` returns `(ciphertext || tag)` together, so the on-disk blob is literally `header || ct||tag`. Decryption: parse header, `crypto.subtle.decrypt({name:'AES-GCM', iv:nonce}, dek, ct||tag)`.

**(B) Sidecar metadata + raw ciphertext object** (more S3-friendly for range-GETs, slightly more complex). For MVP, (A) is fine — a Markdown note + image is small; one PUT/GET per file is the dominant cost anyway.

Recommended: **(A)**. Mirror Cryptomator's per-file approach but flatter (Cryptomator uses a directory per file with `masterkey.cryptomator` style metadata; we can use a single self-describing object because we control the reader).

The KDF params (iterations, salt) could live in *one* vault-level `keywrap` object rather than repeated per file — saves bytes and means iteration upgrades only re-wrap one blob. Recommended hybrid:
- Vault-level remote object `__quill__/keywrap.json`: `{version, kdf:{algo,iter,salt}, wrappedMasterKey: <base64>, nonce}`.
- Per-file remote object: `[magic][version][wrappedDEK][nonce][ct||tag]` (no KDF params repeated).

This is exactly the Cryptomator topology (one `masterkey.cryptomator` + many per-file dirs).

### 5. Multi-Device Key Management

The hard problem. Options observed in the wild:

| Scheme | How device B gets the key |
|---|---|
| **Obsidian Sync** (closed source, E2E add-on) | Service-hosted, but E2E mode: passphrase derives key locally; "Unlock with password" on device B re-derives. Recovery code / Obsidian account fallback. |
| **Standard Notes** | Account password → PBKDF2 → root key. Encrypted key material synced via their server. Cross-device: log in with account, enter password. |
| **Cryptomator** | A `masterkey.cryptomator` JSON file *in the vault root* (on the cloud storage) containing the wrapped master key + KDF params. Device B opens the same cloud vault, reads `masterkey.cryptomator`, prompts for passphrase, unwraps. No server account needed. |
| **age / magic-wormhole** | Key is shared out-of-band (recipient file, QR). No server-side bootstrap. |

For Quill (server = dumb S3/WebDAV, no auth backend), the **Cryptomator model fits best**:

1. First device: user enables E2E in Settings, sets passphrase.
   - Generate random 16-byte salt, random 32-byte master key.
   - KEK = PBKDF2(passphrase, salt, iters).
   - wrappedMaster = AES-GCM(KEK, nonce1, masterKey).
   - Upload `__quill__/keywrap.json = {version, kdf:{...}, wrappedMaster, nonce1}`.
2. Device B: user enables E2E, enters passphrase.
   - Fetch `keywrap.json` from remote, read salt+iters+wrappedMaster.
   - KEK = PBKDF2(passphrase, salt, iters). Unwrap master key. (Wrong passphrase → GCM tag fails → clear error.)
3. Per file: random DEK, `ct = AES-GCM(DEK, nonce2, plaintext)`, `wrappedDEK = AES-GCM(masterKey, nonce3, DEK)`, upload `header||ct`.
4. Device B reads file: parse header → unwrap DEK with masterKey → decrypt ct.

**Recovery / lost passphrase**: there is **no** server-side recovery. If the user loses the passphrase, the data is gone. Mitigations to document:
- Export the *master key* (raw, unwrapped) to a local key file on first enable (user stores it offline). This is the Cryptomator "recovery key" feature.
- Optional future: OS keychain (macOS Keychain via Rust `keyring` crate) to cache the unwrapped master key so the user doesn't re-enter the passphrase every launch.

**Wrong-passphrase UX**: GCM tag verification failure is the signal. Do *not* rely on a separate password hash.

### 6. Binary vs Text Files

No cryptographic difference. AES-GCM is a byte-stream AEAD. The only practical differences for a vault with images:

- **Memory**: a 50 MB image must be loaded into a JS `ArrayBuffer` for `crypto.subtle.encrypt`. That's fine for typical vault images; for very large media (video), stream in chunks (chunked AES-GCM with a counter nonce) — out of scope for MVP.
- **Compression**: do **not** compress before encryption unless you're sure the format already does (JPEG/PNG do; Markdown does not). Compression-then-encrypt leaks length metadata but is generally acceptable. For MVP: encrypt raw bytes, no compression.
- **Diff/sync metadata**: the remote object's `etag`/`size` will change every version because the DEK + nonce are fresh each time — fine, that's how we detect "remote changed". (See `remote-change-detection.md` for the interaction.)

### 7. Re-encryption on Edit

**Whole-file re-encryption** is the correct MVP choice:
- Generate fresh DEK + fresh nonce, encrypt the entire new file content, PUT a new object.
- Old version (if the remote supports versioning, e.g. S3 bucket versioning) remains retrievable; otherwise overwritten.
- Range/partial updates (CTR mode + chunk re-encryption) are an optimization that adds huge complexity (nonce/counter state, partial-tag verification, chunk-boundary alignment with edit offsets) for negligible gain on Markdown notes. Explicitly out of scope.

---

## Mapping onto Quill

### Where things live

| Concern | Location | Notes |
|---|---|---|
| Crypto primitives (AES-GCM, PBKDF2, random) | `apps/desktop/src/services/crypto/*` (renderer, WebCrypto) | Pure functions: `deriveKey`, `encryptFile`, `decryptFile`, `wrapKey`, `unwrapKey`. No DOM/state. |
| Vault key manager (load/save keywrap, unlock) | `apps/desktop/src/services/sync/cryptoKeyManager.ts` | Talks to `S3VaultProvider` to fetch/push `__quill__/keywrap.json`. Caches unwrapped master key in-memory for session. |
| Encryption layer in sync engine | wraps `VaultProvider.writeFile`/`readFile` for the *remote* provider when `e2eEncrypt` is on | Local provider stays plaintext (the local FS is already the user's trusted store). |
| Settings | `settingsStore.ts` already has `e2eEncrypt: boolean` (default `false`) | Add `e2ePassphrase`? **No** — do not persist the passphrase. Prompt on enable / on session start. Persist only the fact that E2E is on + maybe `keywrapVersion`. |
| Rust side | nothing for MVP | Future: Argon2id, OS keychain, streaming crypto. |

### Concrete MVP scheme

- **Cipher**: AES-256-GCM, WebCrypto `SubtleCrypto`.
- **KDF**: PBKDF2-SHA256, 600,000 iterations, 16-byte salt. Mark upgrade-to-Argon2id as a TODO.
- **Key tiers**: KEK (derived) → master key (random, wrapped, on remote) → DEK (random per file-version, in header).
- **Key flow across devices**: Cryptomator model — `keywrap.json` on remote + passphrase on device B.
- **File layout**: `magic|ver|flags|wrappedDEK_len|wrappedDEK|nonce|ct||tag` (KDF params in vault-level keywrap, not per file).
- **Re-encrypt**: whole-file, fresh DEK + nonce per write.
- **Settings**: keep `e2eEncrypt` boolean; do **not** add a passphrase field to persisted settings.

### Rust vs Renderer

| Task | Where | Why |
|---|---|---|
| AES-GCM encrypt/decrypt | Renderer (WebCrypto) | Native, hardware-accelerated, zero deps, already async-friendly. |
| PBKDF2 key derivation | Renderer (WebCrypto) | Native. |
| Random bytes | Renderer (`crypto.getRandomValues`) | Native CSPRNG. |
| Argon2id (future upgrade) | Rust (`argon2` crate) via `invoke` | Not in WebCrypto. |
| OS keychain (future) | Rust (`keyring` crate) | Renderer can't access Keychain. |
| Large-file streaming (future) | Rust | Avoids `ArrayBuffer` memory ceiling. |
| `keywrap.json` fetch/push | Renderer via existing `S3VaultProvider` | Provider already abstracts S3. |

### Pros / Cons of this MVP

Pros:
- Zero new native dependencies; WebCrypto is in every Tauri webview.
- Cryptomator-validated key model; multi-device works against a dumb object store.
- Passphrase change = re-wrap one master key blob (one object PUT).
- Per-file DEK gives compartmentalization and avoids nonce-reuse footguns.
- E2E toggle already in settings; local provider stays plaintext so no perf impact on editing.

Cons / known weaknesses (document, don't fix in MVP):
- PBKDF2 is weaker than Argon2id against GPU attacks; 600k iters is the floor, not a stretch goal. Upgrade path documented.
- Wrapped master key in `localStorage`/settings sidecar on first enable is weak local storage; OS keychain is the right fix (Rust, future).
- No passphrase recovery — lost passphrase = lost data. Provide a recovery-key export on first enable.
- Whole-file re-encrypt + fresh DEK means every edit rewrites the whole remote object — fine for notes, wasteful for big binary files. Streaming/chunked is future work.
- `crypto.subtle` requires a secure context — Tauri's `tauri://`/`http://localhost` webview counts as secure (verify on the target platform; Tauri desktop is fine, Tauri mobile is out of scope per PRD).

---

## External References

- W3C Web Cryptography API (`SubtleCrypto`): `crypto.subtle.deriveKey` (PBKDF2), `encrypt/decrypt` (AES-GCM), `getRandomValues`. — confirms AES-GCM and PBKDF2 are universally available in webviews; Argon2/scrypt are not.
- OWASP Password Storage Cheat Sheet (2023) — PBKDF2-SHA256 ≥ 600,000 iterations; Argon2id t=2,m=19456KiB,p=1 as the modern default.
- NIST SP 800-38D (GCM) — 96-bit IV is the required/safe length; uniqueness is mandatory.
- Cryptomator Security Architecture (public whitepaper, `docs.cryptomator.org`) — envelope encryption, per-file dir, `masterkey.cryptomator` wrapped by scrypt-derived KEK; the model this recommendation mirrors.
- Standard Notes encryption protocol (public spec, `docs.standardnotes.com`) — AES-256-GCM + PBKDF2-SHA512, per-item DEK, account-derived root key; confirms the same pattern.
- Obsidian Sync documentation — advertises E2E AES-256-GCM with passphrase; exact KDF params not published.
- RFC 8439 (ChaCha20-Poly1305) — alternative cipher considered and rejected for MVP (no WebCrypto support).

> Note: I did not have live web search available in this session, so the OWASP iteration counts, Cryptomator/Standard Notes scheme descriptions, and WebCrypto algorithm availability are reconstructed from training knowledge of their public specs/docs. The cryptographic primitives (AES-GCM nonce uniqueness, PBKDF2/Argon2 tradeoffs, envelope encryption structure) are stable protocol facts. Before finalizing iteration counts or citing exact Cryptomator/Standard Notes params in code comments, re-verify against the live docs — but the *structural* recommendation (envelope + AES-GCM + PBKDF2-in-renderer + Cryptomator-style keywrap) does not change.

---

## Caveats / Not Found

- Exact current iteration counts used by Obsidian Sync and Standard Notes were not verified against live docs in this session — training-time values cited as illustrative.
- Whether Tauri 2's `tauri://` webview is treated as a "secure context" for `crypto.subtle` on every target platform — believed yes on macOS/Windows/Linux desktop, but should be smoke-tested on first implementation. (Mobile is out of scope per PRD.)
- No comparison of existing JS libraries (e.g. `libsodium-wrappers`, `age-wasm`) — for MVP, native WebCrypto avoids the dependency; a libsodium/age comparison could be a follow-up if Argon2id-in-renderer without Rust becomes a hard requirement.
- Per-PRD "Out of Scope": mobile, realtime CRDT, history UI — not researched here.

## Related Specs / Code

| Path | Relevance |
|---|---|
| `.trellis/tasks/07-05-vault/prd.md` | Task PRD; lists E2E as optional, names `syncEngine.ts` location, suggests WebCrypto AES-GCM + PBKDF2 — this research confirms and refines that. |
| `apps/desktop/src/store/settingsStore.ts:71` | `e2eEncrypt: boolean` field (default `false`) — the toggle this scheme keys off. |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri 2 builder; no crypto crate currently — confirms Rust side is greenfield for crypto (intentional for MVP). |
| `packages/vault-provider/src/providers/s3Provider.ts` | Remote provider; `keywrap.json` fetch/push would layer on this. |
| `packages/vault-provider/src/providerInterface.ts` | `VaultProvider` interface (readFile/writeFile/...) — the encryption wrapper sits *above* this, decorating only the *remote* provider when `e2eEncrypt` is on. |
