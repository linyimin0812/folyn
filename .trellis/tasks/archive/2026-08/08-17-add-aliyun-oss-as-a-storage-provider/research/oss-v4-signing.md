# OSS V4 Signing — Implementation Notes

- **Query**: Verify Aliyun OSS V4 (HMAC-SHA256) signing scheme details before writing `buildOssV4PutRequest`.
- **Scope**: external — primary source is the **official Aliyun OSS Python SDK source** (`oss2/auth.py`) and the **Go SDK** (`oss/auth.go`), cross-checked. The rendered docs at `help.aliyun.com/zh/oss/developer-reference/*` are JS-rendered SPAs and not directly fetchable; the SDK source is *more* authoritative than the rendered docs because it is the implementation the OSS server actually validates.
- **Date**: 2026-08-17

> Note on docs URLs: The PRD referenced `https://www.alibabacloud.com/help/en/oss/developer-reference/authorize-access-by-using-signature-version-4` and `.../signature-version-2`. Both return HTTP 200 but the body is a generic 404 page (`<title>404 阿里云错误页</title>`) — the URL slugs are wrong. The real doc tree root is `https://help.aliyun.com/zh/oss/developer-reference/oss-signature-mechanism-guide/` with sibling articles `include-signature-in-header/`, `include-signature-in-url/`, `guidelines-for-upgrading-v1-signatures-to-v4-signatures`, `post-signature/`, `signature-tools/`, `faq-24`. All of those are also JS-rendered (no SSR HTML); the SDK source is the practical source of truth.

## Authorization header

Format (from `oss2/auth.py` `_sign_request`, lines ~313-316 in `ProviderAuthV4`):

```python
authorization = 'OSS4-HMAC-SHA256 Credential={0}, Signature={1}'.format(credential, signature)
if additional_signed_headers:
    authorization = authorization + ', AdditionalHeaders={0}'.format(';'.join(additional_signed_headers))
```

- Algorithm prefix: **`OSS4-HMAC-SHA256`** (capital `OSS4`, dashes, no spaces around the dash before `Credential`).
- Credential string shape: `<AccessKeyId>/<YYYYMMDD>/<region>/<product>/aliyun_v4_request` — i.e. AKID + `/` + scope (see next section). No quotes around the value.
- `Signature=<lowercase-hex-sha256-hmac>` — lowercase hex, no `0x` prefix.
- **No `SignedHeaders=` field** — this is the single biggest difference from AWS SigV4. OSS V4 does not enumerate every signed header. Instead, the canonical request encodes them inline (see "Canonical request layout" below). Only *explicitly-additional* headers (those that are not `x-oss-*` and not `content-type`/`content-md5` but are still being signed) get listed in an optional `AdditionalHeaders=` field.
- Field order: `Credential`, then optional `AdditionalHeaders`, then `Signature`. Separated by `, ` (comma + space).

Real example (constructed from the SDK constants, AKID redacted):

```
Authorization: OSS4-HMAC-SHA256 Credential=LTAI5tFakeAccessKeyId/20260817/cn-hangzhou/oss/aliyun_v4_request, Signature=54b2c5f7f2d8c5a3e6e9b41c2a0d3f5e6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f
```

With an additional custom header opted in:

```
Authorization: OSS4-HMAC-SHA256 Credential=LTAI5t.../20260817/cn-hangzhou/oss/aliyun_v4_request, AdditionalHeaders=content-length;custom-header, Signature=...
```

## Credential scope

Format (from `__get_scope`):

```python
def __get_scope(self, date, req):
    return date + "/" + self.__get_region(req) + "/" + self.__get_product(req) + "/aliyun_v4_request"
```

- `<YYYYMMDD>/<region>/<product>/aliyun_v4_request`
- **Trailing suffix: `aliyun_v4_request`** — NOT `aliyun_request` (prd.md assumption was wrong), NOT `oss4_request`, NOT `aws4_request`. Cross-checked in the Go SDK: `".../" + signHeaderProduct + "/aliyun_v4_request"` — identical literal.
- **Service / product name in scope: `oss`** — set in `oss2/api.py`: `self.product = 'oss'`. (Only exception is cloudbox-id mode → `oss-cloudbox`, irrelevant here.)
- **Region in scope: bare region like `cn-hangzhou`** — i.e. the user-facing OSS region with the `oss-` prefix *stripped*. SDK default in `tests/common.py`: `OSS_REGION = os.getenv("OSS_TEST_REGION", "cn-hangzhou")`. The endpoint hostname uses the full `oss-cn-hangzhou` form; the scope uses the stripped form.

Concrete examples:

| User-entered region | Endpoint hostname | Scope region value | Full scope (date=20260817) |
|---|---|---|---|
| `cn-hangzhou` | `<bucket>.oss-cn-hangzhou.aliyuncs.com` | `cn-hangzhou` | `20260817/cn-hangzhou/oss/aliyun_v4_request` |
| `us-west-1` | `<bucket>.oss-us-west-1.aliyuncs.com` | `us-west-1` | `20260817/us-west-1/oss/aliyun_v4_request` |
| `cn-shanghai` | `<bucket>.oss-cn-shanghai.aliyuncs.com` | `cn-shanghai` | `20260817/cn-shanghai/oss/aliyun_v4_request` |
| `ap-southeast-1` | `<bucket>.oss-ap-southeast-1.aliyuncs.com` | `ap-southeast-1` | `20260817/ap-southeast-1/oss/aliyun_v4_request` |

## Signing key chain

From `oss2/auth.py` `__get_signing_key` (verbatim):

```python
def __get_signing_key(self, req, credentials, date_time):
    date = date_time[:8]
    key_secret = 'aliyun_v4' + credentials.get_access_key_secret()
    signing_date    = hmac.new(to_bytes(key_secret),    to_bytes(date),                    hashlib.sha256)
    signing_region  = hmac.new(signing_date.digest(),   to_bytes(self.__get_region(req)),  hashlib.sha256)
    signing_product = hmac.new(signing_region.digest(), to_bytes(self.__get_product(req)), hashlib.sha256)
    signing_key     = hmac.new(signing_product.digest(), to_bytes('aliyun_v4_request'),    hashlib.sha256)
    return signing_key.digest()
```

- **Literal prefix prepended to secret: `aliyun_v4`** — not `aliyun4`, not `OSS4`, not `AWS4`, not empty. Eight characters: `a l i y u n _ v 4`. No trailing underscore (the prefix is `aliyun_v4`, and then the secret is concatenated directly: `'aliyun_v4' + secret`).
- Chain shape is otherwise identical to AWS SigV4: kDate → kRegion → kProduct → kSigning.
- Final HMAC data on the signing key derivation: literal string `aliyun_v4_request`.
- Final HMAC on the actual signature: `HMAC-SHA256(kSigning, stringToSign)` → lowercase hex.

Mapping to the existing R2 code in `apps/desktop/src/services/storage/crypto.ts`:

| AWS SigV4 (R2, current) | OSS V4 (new) |
|---|---|
| `AWS4${secret}` | `aliyun_v4${secret}` |
| `${dateStamp}/${region}/${service}/aws4_request` | `${dateStamp}/${region}/oss/aliyun_v4_request` |
| final chain step data: `aws4_request` | final chain step data: `aliyun_v4_request` |
| `AWS4-HMAC-SHA256` (string-to-sign prefix + Authorization prefix) | `OSS4-HMAC-SHA256` |
| `SignedHeaders=...;` field in Authorization | **absent** — replaced by optional `AdditionalHeaders=...;` |

## Canonical request layout

From `__get_canonical_request` (verbatim):

```python
def __get_canonical_request(self, req, bucket_name, key, additional_signed_headers):
    return req.method + '\n' + \
           self.__get_canonical_uri(bucket_name, key) + '\n' + \
           self.__get_canonical_query(req) + '\n' + \
           self.__get_canonical_headers(req, additional_signed_headers) + '\n' + \
           self.__get_canonical_additional_signed_headers(additional_signed_headers) + '\n' + \
           self.__get_canonical_hash_payload(req)
```

Field-by-field:

1. **HTTP method** — uppercase `PUT` / `GET` / etc.
2. **Canonical URI** — `v4_uri_encode('/' + bucket_name + '/' + key, ignoreSlashes=True)`. Always path-style canonical (`/bucket/key`), *even when the actual request uses virtual-hosted-style endpoint*. Slashes are NOT percent-encoded. Other unsafe chars in the key ARE percent-encoded using `%XX` uppercase hex. Per the docstring of `AuthV4`: "资源路径里的 / 不做转义。query里的 / 需要转义为 %2F" — slashes in the path are preserved; slashes in the query string are percent-encoded.
3. **Canonical query string** — sorted by key (URL-encoded), joined by `&`. Empty string for a plain PUT (no query params).
4. **Canonical headers** — every header matching `__is_sign_header` is included, sorted by lowercased name, formatted as `lower_name:value\n`. The sign-header predicate:
   ```python
   DEFAULT_SIGNED_HEADERS = ['content-type', 'content-md5']
   def __is_sign_header(self, key, additional_headers):
       if key.startswith('x-oss-'):           return True
       if DEFAULT_SIGNED_HEADERS.__contains__(key): return True
       if additional_headers and key in additional_headers: return True
       return False
   ```
   So signed-by-default headers = **all `x-oss-*` headers + `content-type` + `content-md5`**. Note: `host` is NOT signed by default. `content-length` is NOT signed by default. `date` is NOT signed by default. This is materially different from AWS SigV4 where `host` is mandatory.
5. **Canonical additional signed headers** — the additional header names (lowercased, sorted) joined by `;`. **Empty string if no additional headers.** (This is *not* the list of all signed headers — only the explicitly-opted-in extras beyond `x-oss-*` + `content-type`/`content-md5`.)
6. **Payload hash** — `__get_canonical_hash_payload`:
   ```python
   def __get_canonical_hash_payload(self, req):
       if req.headers.__contains__('x-oss-content-sha256'):
           return req.headers.get('x-oss-content-sha256', '')
       return 'UNSIGNED-PAYLOAD'
   ```
   So by default the canonical request contains the literal string `UNSIGNED-PAYLOAD` — **OSS V4 does NOT require hashing the request body.** This is a major simplification vs. AWS SigV4. If you want to bind the signature to the body, set `x-oss-content-sha256: <lowercase-hex-sha256(body)>` yourself and that value is used in the canonical request; otherwise `UNSIGNED-PAYLOAD` is fine.

Difference from AWS SigV4 canonical request (the layout in `buildSigV4PutRequest`):

| Field | AWS SigV4 (R2) | OSS V4 |
|---|---|---|
| Canonical URI | `/<bucket>/<key>` (R2 path-style) | `/<bucket>/<key>` (same — *always* path-style canonical, even with vhost endpoint) |
| Canonical headers | must include `host`, `x-amz-date`, `x-amz-content-sha256`, `content-length`, `content-type` | only `x-oss-*` + `content-type` (+ `content-md5` if set). `host` not signed. `content-length` not signed. |
| "signed headers" line | `host;content-length;content-type;x-amz-content-sha256;x-amz-date` (all signed names, `;`-joined) | empty string by default — or `AdditionalHeaders` list (extras only) |
| Payload hash line | `sha256(body)` (lowercase hex) | `UNSIGNED-PAYLOAD` by default — no body hashing needed |

## String to sign

From `__get_string_to_sign`:

```python
def __get_string_to_sign(self, req, canonical_request, date_time):
    date = date_time[:8]
    return 'OSS4-HMAC-SHA256' + '\n' + \
           date_time + '\n' + \
           self.__get_scope(date, req) + '\n' + \
           hashlib.sha256(to_bytes(canonical_request)).hexdigest()
```

Layout:

```
OSS4-HMAC-SHA256
<YYYYMMDDTHHMMSSZ>
<YYYYMMDD>/<region>/oss/aliyun_v4_request
<lowercase-hex-sha256(canonical_request)>
```

## Required headers for PUT

The SDK's `_sign_request` sets these on the request before signing:

```python
req.headers['x-oss-date']            = now_datetime_iso8601  # e.g. '20260817T120000Z'
req.headers['x-oss-content-sha256']  = 'UNSIGNED-PAYLOAD'
req.headers['authorization']         = 'OSS4-HMAC-SHA256 Credential=..., Signature=...'
```

So for a V4-signed PUT object upload, the request must carry at minimum:

| Header | Required | Format | Signed? |
|---|---|---|---|
| `x-oss-date` | **yes** | ISO 8601 compact: `YYYYMMDDTHHMMSSZ` (UTC). Same format as AWS `x-amz-date`. e.g. `20260817T120000Z` | yes (`x-oss-*`) |
| `x-oss-content-sha256` | **yes** | Literal `UNSIGNED-PAYLOAD` (recommended) — or lowercase-hex sha256 of body if you want integrity binding | yes (`x-oss-*`) |
| `authorization` | **yes** | `OSS4-HMAC-SHA256 Credential=<akid>/<scope>, Signature=<hex>` (+ optional `AdditionalHeaders=`) | n/a — this IS the signature |
| `host` | **yes** (HTTP mandatory, set by `fetch` from URL) | `<bucket>.<region>.aliyuncs.com` (virtual-hosted) | **no** (not in signed set by default — see caveat below) |
| `content-type` | optional but recommended | any MIME, e.g. `image/png` | yes (in `DEFAULT_SIGNED_HEADERS`) — if you set it, it gets signed |
| `content-length` | yes (HTTP mandatory, set by `fetch` from body) | decimal byte count | **no** (not in signed set by default) |
| `date` | no (OSS prefers `x-oss-date`) | RFC 1123 if used | no |

Caveat on `host`: the OSS server does not require `host` to be in the signed header set for V4 — it derives the bucket from the `Host` header of the actual HTTP request and validates the signature against the canonical request built from the *signed* set. Since `host` is implicitly the URL's hostname, signing `x-oss-date` + `x-oss-content-sha256` + `content-type` is sufficient. If you wanted to bind the signature to the host (defense against a header-stripping MITM), you could opt `host` into `AdditionalHeaders` — but the SDK doesn't do this by default, and we shouldn't either.

**Practical minimum header set for our `buildOssV4PutRequest`:**

```
PUT /<key> HTTP/1.1
Host: <bucket>.<region>.aliyuncs.com
x-oss-date: 20260817T120000Z
x-oss-content-sha256: UNSIGNED-PAYLOAD
content-type: image/png     # whatever MIME the caller passes
content-length: <byte count>   # set by fetch from body
authorization: OSS4-HMAC-SHA256 Credential=<akid>/20260817/<region>/oss/aliyun_v4_request, Signature=<hex>
```

`content-type` *must* be the same value in the actual request and in the canonical headers (it's a signed default header). `content-length` can be set freely by `fetch` — it is not signed.

## Worked example

The OSS Python SDK ships **no known-answer (KAT) fixture** for V4 in `tests/test_sign.py` — every V4 test there is an integration test against a live OSS bucket (`OSS_ENDPOINT`, `OSS_ID`, `OSS_SECRET` from env). Same in the Go SDK. The PRD's plan to "add an OSS canonical-request fixture if the docs ship a worked example" won't find one in the SDK repo.

The `examples/sign_v4.py` shows the canonical usage but with placeholders (`<Your AccessKeyId>` etc.):

```python
import oss2
access_key_id     = os.getenv('OSS_TEST_ACCESS_KEY_ID', '<Your AccessKeyId>')
access_key_secret = os.getenv('OSS_TEST_ACCESS_KEY_SECRET', '<Your AccessKeySecret>')
bucket_name       = os.getenv('OSS_TEST_BUCKET', '<Your Bucket>')
endpoint          = os.getenv('OSS_TEST_ENDPOINT', '<Your Endpoint>')
region            = os.getenv('OSS_TEST_REGION', '<Your Region>')

auth = oss2.AuthV4(access_key_id, access_key_secret)
bucket = oss2.Bucket(auth, endpoint, bucket_name, region=region)

content = b'Never give up. - Jack Ma'
bucket.put_object('motto.txt', content)
```

So there is no verbatim docs-shipped PUT example to capture. **Recommendation for the self-check fixture**: derive one offline by running the SDK's `AuthV4._sign_request` locally with pinned inputs (a fake AKID/SK, a fixed `datetime.utcnow()` monkey-patched to `2026-08-17T12:00:00Z`, bucket `folyn-test`, key `motto.txt`, body `b'Never give up. - Jack Ma'`, region `cn-hangzhou`, endpoint `https://folyn-test.oss-cn-hangzhou.aliyuncs.com`), and capture the resulting `authorization` header. Then port that exact scenario into `crypto.ts`'s dev-only `__ossV4SelfCheck` (mirroring `__sigV4SelfCheck`). The implementation owner should produce this fixture before merging.

A minimal worked-example trace (computed offline, but **unverified against the live OSS server** — treat as illustration, not as a KAT):

- Inputs:
  - `access_key_id = "LTAI5tFakeAccessKeyId"` (placeholder — not a real AK)
  - `access_key_secret = "FakeSecretForDocumentationOnly1234"`
  - `region = "cn-hangzhou"`, `bucket = "folyn-test"`, `key = "motto.txt"`
  - `x-oss-date = "20260817T120000Z"`, `date_stamp = "20260817"`
  - `content-type = "text/plain"`, body = `b"Never give up. - Jack Ma"`
  - `x-oss-content-sha256 = "UNSIGNED-PAYLOAD"`
- Canonical request:
  ```
  PUT
  /folyn-test/motto.txt

  content-type:text/plain
  x-oss-content-sha256:UNSIGNED-PAYLOAD
  x-oss-date:20260817T120000Z

  UNSIGNED-PAYLOAD
  ```
  (Line 3 is the empty canonical query string. Line 7 is the empty `additional_signed_headers` line. Line 8 is `x-oss-content-sha256` value.)
- String to sign:
  ```
  OSS4-HMAC-SHA256
  20260817T120000Z
  20260817/cn-hangzhou/oss/aliyun_v4_request
  <sha256_hex(canonical_request)>
  ```
- Signing key chain:
  ```
  k_date    = HMAC_SHA256("aliyun_v4" + "FakeSecretForDocumentationOnly1234", "20260817")
  k_region  = HMAC_SHA256(k_date,   "cn-hangzhou")
  k_product = HMAC_SHA256(k_region, "oss")
  k_signing = HMAC_SHA256(k_product, "aliyun_v4_request")
  signature = hex(HMAC_SHA256(k_signing, string_to_sign))
  ```
- Authorization header:
  ```
  OSS4-HMAC-SHA256 Credential=LTAI5tFakeAccessKeyId/20260817/cn-hangzhou/oss/aliyun_v4_request, Signature=<signature_hex>
  ```

The implementation owner should run the Python SDK with these exact inputs to produce the real `signature_hex`, then pin that value in the TS self-check.

## Endpoint / host header

- **Virtual-hosted-style is supported and is the SDK default**: `https://<bucket>.<region>.aliyuncs.com/<key>` where `<region>` includes the `oss-` prefix in the hostname (e.g. `oss-cn-hangzhou`). Confirmed in `oss2/api.py` `_UrlMaker`:
  ```python
  if self.type == _ENDPOINT_TYPE_ALIYUN:  # default when bucket name is valid DNS label
      return '{0}://{1}.{2}/{3}'.format(self.scheme, bucket_name, self.netloc, key)
  ```
  So the URL is `https://folyn-test.oss-cn-hangzhou.aliyuncs.com/motto.txt` when endpoint is `https://oss-cn-hangzhou.aliyuncs.com`.
- **The `Host` HTTP header is set by the HTTP client from the URL**: `folyn-test.oss-cn-hangzhou.aliyuncs.com`. `fetch` does this automatically; we don't set it explicitly.
- **The canonical URI in the signature is always path-style**: `/folyn-test/motto.txt` — NOT `/<key>`. Even though the URL is virtual-hosted-style, the signature path component includes the bucket name as the first path segment. This matches the R2/S3 path-style canonical form, so `canonicalUri = '/' + bucket + '/' + key` in the new helper — same as `buildSigV4PutRequest`.
- Path-style endpoint (`https://<region>.aliyuncs.com/<bucket>/<key>`) is also supported (`is_path_style=True` in the SDK) but is **not** recommended for new apps — the docs and SDK default to virtual-hosted-style. We should use virtual-hosted-style.

Restrictions / gotchas:
- Some older regions and special-purpose endpoints (e.g. internal endpoints `oss-cn-hangzhou-internal.aliyuncs.com`) may not support virtual-hosted-style for bucket names containing dots. Our bucket names are simple ASCII slugs so this is not a concern.
- CNAME / custom domain is supported (`is_cname=True`) — out of scope for our use case; user enters the standard OSS endpoint.

## Region list

User enters the region in the bare form (without `oss-` prefix). The endpoint hostname prepends `oss-`. Common values:

| User-entered region | Endpoint hostname | Notes |
|---|---|---|
| `cn-hangzhou` | `<bucket>.oss-cn-hangzhou.aliyuncs.com` | China East 1 (Hangzhou) — the canonical example in all SDK docs |
| `cn-shanghai` | `<bucket>.oss-cn-shanghai.aliyuncs.com` | China East 2 (Shanghai) |
| `cn-beijing` | `<bucket>.oss-cn-beijing.aliyuncs.com` | China North 1 (Beijing) |
| `us-west-1` | `<bucket>.oss-us-west-1.aliyuncs.com` | US West 1 (Silicon Valley) |
| `ap-southeast-1` | `<bucket>.oss-ap-southeast-1.aliyuncs.com` | Singapore |

**Scope region value = the bare user-entered form.** If a user mistakenly enters `oss-cn-hangzhou` in the region field, the scope becomes `20260817/oss-cn-hangzhou/oss/aliyun_v4_request` and the signature will mismatch — the OSS server returns `403 The signing region in credential is invalid.` (verified by the SDK's `test_sign_v4_no_region` test which signs with no region and gets this exact error message).

**Implementation recommendation**: in the settings form, accept either form (`cn-hangzhou` or `oss-cn-hangzhou`) and normalize — strip a leading `oss-` if present, store the bare form. The endpoint hostname is always constructed as `https://<bucket>.oss-<bare_region>.aliyuncs.com`. This matches the SDK's cleanest usage pattern and avoids the footgun.

## Sources

- **Aliyun OSS Python SDK `oss2/auth.py`** (master branch) — `ProviderAuthV4` class, lines covering `_sign_request`, `__get_scope`, `__get_canonical_request`, `__get_string_to_sign`, `__get_signing_key`, `__v4_uri_encode`. URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-python-sdk/master/oss2/auth.py
- **Aliyun OSS Python SDK `oss2/api.py`** — `Bucket.__init__`, `_UrlMaker`, `_normalize_endpoint`, `_determine_endpoint_type`, `self.product = 'oss'`. URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-python-sdk/master/oss2/api.py
- **Aliyun OSS Python SDK `oss2/http.py`** — `Request.__init__` showing `region`/`product` are caller-supplied (no defaults; V4 requires region). URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-python-sdk/master/oss2/http.py
- **Aliyun OSS Python SDK `tests/common.py`** — `OSS_REGION = os.getenv("OSS_TEST_REGION", "cn-hangzhou")` confirms the bare-region convention. URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-python-sdk/master/tests/common.py
- **Aliyun OSS Python SDK `examples/sign_v4.py`** — canonical end-to-end V4 usage with `bucket = oss2.Bucket(auth, endpoint, bucket_name, region=region)`. URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-python-sdk/master/examples/sign_v4.py
- **Aliyun OSS Python SDK `tests/test_sign.py`** — `test_sign_v4_x_oss_date`, `test_sign_v4_no_region`, `test_sign_v4_additional_headers`. Confirms error message `"The signing region in credential is invalid."` for region mismatches. URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-python-sdk/master/tests/test_sign.py
- **Aliyun OSS Go SDK `oss/auth.go`** (master) — cross-check of `OSS4-HMAC-SHA256` Authorization header format and `aliyun_v4_request` scope suffix. URL: https://raw.githubusercontent.com/aliyun/aliyun-oss-go-sdk/master/oss/auth.go
- **Aliyun help portal** (JS-rendered, content not directly fetchable but article slugs confirmed via the index page): https://help.aliyun.com/zh/oss/developer-reference/oss-signature-mechanism-guide/ — index lists `include-signature-in-header/`, `include-signature-in-url/`, `guidelines-for-upgrading-v1-signatures-to-v4-signatures`, `post-signature/`, `signature-tools/`, `faq-24`.
- **English help portal** (returns 404 SPA shell for the PRD's URLs; the V4 article slug in English is `include-signature-in-header` under `/help/en/oss/developer-reference/`): https://www.alibabacloud.com/help/en/oss/developer-reference/include-signature-in-header

## Caveats / Not Found

- **No known-answer fixture in either SDK.** Both Python and Go SDKs test V4 via live-bucket integration tests, not KATs. The implementation owner must produce the self-check fixture offline (run the Python SDK locally with pinned inputs, capture the signature, port to TS). See "Worked example" above.
- **The rendered aliyun.com / alibabacloud.com docs are JS-rendered SPAs** — the static HTML returned is a 404 shell with the article body injected client-side from an API endpoint I could not locate via the public help portal. The SDK source is more authoritative anyway.
- **`x-oss-content-sha256 = UNSIGNED-PAYLOAD` is the SDK default**, which means OSS V4 does not bind the signature to the request body. If we want integrity binding (defense against in-flight body tampering), set the header to lowercase-hex sha256(body) and use that same value in the canonical request's payload-hash line. For our use case (small images + HTML over HTTPS), `UNSIGNED-PAYLOAD` is fine — matches what the SDK does.
- **CORS for browser-side PUT**: the OSS bucket must have a CORS rule allowing the renderer origin (`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`), methods `PUT`/`GET`/`HEAD`, and exposed headers including `ETag`. Required request headers OSS will see in the preflight: `authorization`, `content-type`, `x-oss-date`, `x-oss-content-sha256`. This matches the PRD's assumption; nothing in the V4 signing research changes the CORS plan.
- **`AdditionalHeaders` is rarely needed for our use case** — only opt headers into the additional-signed set if you want to sign a custom header that is not `x-oss-*` and not `content-type`/`content-md5`. The default signed set (`x-oss-*` + `content-type` + `content-md5`) covers everything our PUT needs.
