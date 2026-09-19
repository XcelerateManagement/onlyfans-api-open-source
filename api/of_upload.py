#!/usr/bin/env python3
"""OnlyFans media upload — the signed-S3 + converter pipeline.

Reverse-engineered from the OF web client build `202608060907-8ff70a44ee`
(chunk `75202.js` module `975202` = the uploader, module `511627` = the API
wrappers, chunk `21914.js` module `921914` `i7` = the key generator). Every
constant below is taken from that code, and the config values are read live
from the account rather than hardcoded.

There is **no** `POST /api2/v2/media`. That route was documented here for a long
time and never existed — OF answers it with 404 "Route not found." The real
flow is four stages:

    1. POST /api2/v2/upload/signed/create  {key, parts, contentType, secure}
         -> {putUrl | keys[].putUrl, uploadId, getUrl}
    2. PUT the bytes straight to S3 at putUrl (NO OnlyFans auth on this hop —
       the signature is in the URL; sending cookies/sign makes S3 reject it)
    3. POST /api2/v2/upload/signed/finish {key, parts[{ETag,PartNumber}],
       uploadId, secure}  -- multipart only; a single PUT already returns ETag
    4. POST multipart/form-data to the converter host (convert.onlyfans.com,
       from GET /api2/v2/init) with the S3 descriptor + the account's upload
       preset. This is what actually mints the vault item.

Stage 4 returns a `processId`, not a plain vault id. A post/message body accepts
either an existing vault `id` or a freshly-converted `{processId, host, name,
extra}` — see `media_reference()`.

**An upload does not create a vault item**, and that is OnlyFans' behaviour
rather than a gap here. OF has no upload-to-vault endpoint: the whole
`/vault/*` surface is read/organise (list, get, hash lookup, hide, folders,
attach) with no create, and the uploader is wired only into the post/message
composer (`media-vault.js` and `vault-lists.js` never import it). The vault
row is created when a post/message/story consumes the processId.

Verified 2026-08-06 over ~4 minutes after a successful upload: absent from
GET /vault/media, absent from GET /vault/media/processing, and
GET /vault/media/hash?h={md5}&size={bytes} returns 404 "Media Not Found" —
that last one is the exact call the OF client makes to decide whether a file
is already in the vault, so OF genuinely has no vault row for it. (The S3
object itself is fine: for a single-part upload the returned ETag equals the
local md5 of the bytes, so the upload is byte-exact.)

`key` is why every guessed body shape came back `Bad key`: the field is
literally named `key`, and it must be a path the signer will accept:

    {uploadPath}{uuid4}/{nonce}/{url-encoded lowercased filename}

with `uploadPath` = `upload/` (or `upload/secure/` when secure=True) read from
GET /api2/v2/init -> upload.s3.
"""

import mimetypes
import os
import random
import time
import uuid
from urllib.parse import quote, urlparse

import requests

import config
from of_client import handle_of_request

# ── constants lifted verbatim from the web client ────────────────────────────
PART_SIZE = 5242880                                  # 5 MiB (`D` in 975202)
EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e'       # S3's etag for zero bytes
DEFAULT_PRESET = 'of_beta'
S3_TIMEOUT = 300
CONVERT_TIMEOUT = 300

# A file at or above one part is uploaded as S3 multipart; below it, one PUT.
MULTIPART_THRESHOLD = PART_SIZE


class UploadError(Exception):
    """Raised when any stage of the pipeline fails. `stage` says which."""

    def __init__(self, message, stage=None, status=None, detail=None):
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.status = status
        self.detail = detail

    def to_dict(self):
        out = {'error': self.message, 'stage': self.stage}
        if self.status is not None:
            out['status_code'] = self.status
        if self.detail is not None:
            out['detail'] = self.detail
        return out


def _proxies(proxy):
    return {'http': proxy, 'https': proxy} if proxy else None


def guess_content_type(filename, provided=None):
    """Mirror the client's type resolution: trust the browser-supplied type,
    special-case .heic (which mimetypes doesn't know), else sniff the extension."""
    name = (filename or '').lower()
    if name.endswith('.heic'):
        return 'image/heic'
    if provided and provided != 'application/octet-stream':
        return provided
    guessed, _ = mimetypes.guess_type(name)
    return guessed or provided or 'application/octet-stream'


def media_type_for(content_type):
    """The converter's coarse media bucket. `photo` maps to `image` and `gif`
    to `video` on the wire (see sendDataToConverter), but the geo-upload type
    list uses the coarse names."""
    ct = (content_type or '').lower()
    if ct.startswith('video/'):
        return 'video'
    if ct.startswith('audio/'):
        return 'audio'
    if ct == 'image/gif':
        return 'gif'
    return 'photo'


def build_key(filename, upload_path):
    """`i7` from module 921914:
        `${uploadPath}${uuidv4()}/${(Math.random()*Date.now()).toFixed(0)}/${enc(name.toLowerCase())}`
    """
    name = quote((filename or 'file').lower(), safe='')
    nonce = f'{random.random() * (time.time() * 1000):.0f}'
    return f'{upload_path}{uuid.uuid4()}/{nonce}/{name}'


def get_upload_config(crm_id, of_user_id, proxy=None):
    """Read the account's live upload config. Two GETs, both read-only:
    /init carries the S3 paths + converter hosts, /users/me the preset args."""
    ok, init, status, _ = handle_of_request(
        crm_id, of_user_id, '/api2/v2/init', method='GET', proxy=proxy)
    if not ok or not isinstance(init, dict):
        raise UploadError('could not read /api2/v2/init', stage='config',
                          status=status, detail=init)

    upload = init.get('upload') or {}
    s3 = upload.get('s3') or {}
    hosts = upload.get('geoUploadHosts') or []
    if not hosts:
        raise UploadError('no geoUploadHosts in init config', stage='config',
                          detail=upload)

    ok, me, status, _ = handle_of_request(
        crm_id, of_user_id, '/api2/v2/users/me', method='GET', proxy=proxy)
    if not ok or not isinstance(me, dict):
        raise UploadError('could not read /api2/v2/users/me', stage='config',
                          status=status, detail=me)

    return {
        'upload_path': s3.get('uploadPath') or 'upload/',
        'secure_upload_path': s3.get('secureUploadPath') or 'upload/secure/',
        'hosts': hosts,
        'geo_upload_types': upload.get('geoUploadTypes') or [],
        'geo_upload_args': ((me.get('upload') or {}).get('geoUploadArgs') or {}),
    }


def _flatten(prefix, value, out):
    """Flatten nested dicts into PHP-style bracket keys, the shape the client's
    FormData serializer (`P`) produces: additional[user], file[ETag], ..."""
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f'{prefix}[{k}]' if prefix else str(k), v, out)
    elif isinstance(value, bool):
        out[prefix] = '1' if value else '0'
    elif value is None:
        return
    else:
        out[prefix] = str(value)


def _create_signed(crm_id, of_user_id, key, parts, content_type, secure, proxy):
    body = {'key': key, 'parts': parts,
            'contentType': content_type, 'secure': secure}
    ok, data, status, _ = handle_of_request(
        crm_id, of_user_id, '/api2/v2/upload/signed/create',
        method='POST', body=body, proxy=proxy)
    if not ok or not isinstance(data, dict):
        raise UploadError('upload/signed/create rejected the request',
                          stage='create', status=status, detail=data)
    return data


def _put_part(url, blob, content_type, proxy):
    """Stage 2. Deliberately a bare `requests` PUT: the signature lives in the
    URL, and attaching OF's cookies/sign headers makes S3 400."""
    resp = requests.put(url, data=blob,
                        headers={'Content-Type': content_type},
                        proxies=_proxies(proxy), timeout=S3_TIMEOUT)
    if resp.status_code not in (200, 201):
        raise UploadError(f'S3 PUT failed ({resp.status_code})', stage='put',
                          status=resp.status_code, detail=resp.text[:400])
    etag = (resp.headers.get('etag') or resp.headers.get('ETag') or '').strip('"')
    if not etag:
        raise UploadError('S3 PUT returned no ETag', stage='put',
                          status=resp.status_code)
    if etag == EMPTY_MD5:
        raise UploadError('S3 stored an empty object (file too small/empty)',
                          stage='put', status=resp.status_code)
    return etag


def _finish_signed(crm_id, of_user_id, key, parts, upload_id, secure, proxy):
    body = {'key': key, 'parts': parts, 'uploadId': upload_id, 'secure': secure}
    ok, data, status, _ = handle_of_request(
        crm_id, of_user_id, '/api2/v2/upload/signed/finish',
        method='POST', body=body, proxy=proxy)
    if not ok or not isinstance(data, dict):
        raise UploadError('upload/signed/finish rejected the request',
                          stage='finish', status=status, detail=data)
    etag = (data.get('ETag') or data.get('etag') or '').strip('"')
    if not etag:
        raise UploadError('upload/signed/finish returned no ETag',
                          stage='finish', detail=data)
    return etag


def _convert(cfg, descriptor, content_type, proxy, session_headers=None):
    """Stage 4 — hand the S3 descriptor to the converter, which mints the media."""
    media_type = media_type_for(content_type)
    hosts = cfg['hosts']
    if cfg['geo_upload_types'] and media_type not in cfg['geo_upload_types']:
        hosts = hosts[:1]

    args = dict(cfg['geo_upload_args'] or {})
    args['preset'] = args.get('preset') or DEFAULT_PRESET

    fields = {}
    _flatten('', {**args, 'file': descriptor}, fields)

    last = None
    for host in hosts:
        url = host.get('url') if isinstance(host, dict) else str(host)
        if not url:
            continue
        try:
            resp = requests.post(
                url,
                files={k: (None, v) for k, v in fields.items()},
                proxies=_proxies(proxy), timeout=CONVERT_TIMEOUT,
                headers=session_headers or {})
        except Exception as exc:                      # try the next geo host
            last = UploadError(f'converter unreachable: {exc}', stage='convert')
            continue
        if resp.status_code == 200:
            try:
                return resp.json()
            except Exception:
                raise UploadError('converter returned non-JSON',
                                  stage='convert', status=resp.status_code,
                                  detail=resp.text[:400])
        last = UploadError(f'converter rejected the upload ({resp.status_code})',
                           stage='convert', status=resp.status_code,
                           detail=resp.text[:400])
        # 400 is a real rejection of this file — retrying other hosts is noise.
        if resp.status_code == 400:
            break
    raise last or UploadError('no usable converter host', stage='convert')


def upload_media(crm_id, of_user_id, data, filename,
                 content_type=None, proxy=None, secure=False):
    """Run the whole pipeline. Returns the converter's response dict, which
    carries `processId` (+ `host`, `thumbs`, `extra`, `sourceUrl`).

    `data` is raw bytes. Raises UploadError with a `stage` on failure.
    """
    if not data:
        raise UploadError('empty file', stage='input')

    content_type = guess_content_type(filename, content_type)
    cfg = get_upload_config(crm_id, of_user_id, proxy=proxy)
    upload_path = cfg['secure_upload_path'] if secure else cfg['upload_path']
    key = build_key(filename, upload_path)

    size = len(data)
    multipart = size >= MULTIPART_THRESHOLD
    n_parts = (size // PART_SIZE) + 1

    created = _create_signed(crm_id, of_user_id, key,
                             n_parts if multipart else 1,
                             content_type, secure, proxy)

    keys = created.get('keys') or []
    upload_id = created.get('uploadId')
    use_multipart = bool(keys) and multipart

    if use_multipart:
        parts = []
        for idx in range(n_parts):
            blob = data[idx * PART_SIZE:(idx + 1) * PART_SIZE]
            if not blob:
                continue
            put_url = (keys[idx] or {}).get('putUrl')
            if not put_url:
                raise UploadError(f'no putUrl for part {idx + 1}', stage='create',
                                  detail=created)
            etag = _put_part(put_url, blob, content_type, proxy)
            parts.append({'ETag': f'"{etag}"', 'PartNumber': idx + 1})
        etag = _finish_signed(crm_id, of_user_id, key, parts,
                              upload_id, secure, proxy)
        sample_url = (keys[0] or {}).get('putUrl')
    else:
        put_url = created.get('putUrl')
        if not put_url:
            raise UploadError('create returned no putUrl', stage='create',
                              detail=created)
        etag = _put_part(put_url, data, content_type, proxy)
        sample_url = put_url

    parsed = urlparse(sample_url)
    descriptor = {
        'ETag': etag,
        'Location': f'{parsed.scheme}://{parsed.netloc}{parsed.path}',
        'Key': key,
        'Bucket': parsed.netloc.split('.')[0],
        'name': os.path.basename(filename or 'file'),
        'secure': secure,
    }

    result = _convert(cfg, descriptor, content_type, proxy)
    if isinstance(result, dict):
        result.setdefault('key', key)
        result.setdefault('etag', etag)
        result.setdefault('contentType', content_type)
        result.setdefault('size', size)
        # The converter does not echo these two, but a post/message body needs
        # BOTH of them or OnlyFans accepts the post and silently attaches no
        # media (verified live 2026-08-06 — processId alone gives media=[]).
        result.setdefault('name', os.path.basename(filename or 'file'))
        thumbs = result.get('thumbs') or []
        if result.get('thumbId') is None and thumbs:
            result['thumbId'] = (thumbs[0] or {}).get('id')
    return result


def upload_from_url(crm_id, of_user_id, source_url, filename=None,
                    content_type=None, proxy=None, secure=False,
                    max_bytes=None):
    """Fetch a publicly-reachable URL server-side, then upload it.

    This is the ergonomic path for callers whose media already lives somewhere
    addressable (Drive/S3/CDN) — it removes the multipart hop from their side
    entirely. The fetch is capped and streams into memory.
    """
    max_bytes = max_bytes or getattr(config, 'MEDIA_UPLOAD_MAX_BYTES', 512 * 1024 * 1024)

    try:
        resp = requests.get(source_url, stream=True, timeout=120,
                            proxies=_proxies(proxy))
    except Exception as exc:
        raise UploadError(f'could not fetch source_url: {exc}', stage='fetch')

    if resp.status_code != 200:
        raise UploadError(f'source_url returned {resp.status_code}',
                          stage='fetch', status=resp.status_code)

    declared = resp.headers.get('content-length')
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise UploadError(
            f'source is {int(declared)} bytes, over the {max_bytes} limit',
            stage='fetch')

    chunks, total = [], 0
    for chunk in resp.iter_content(1 << 20):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise UploadError(f'source exceeded the {max_bytes} byte limit',
                              stage='fetch')
        chunks.append(chunk)
    body = b''.join(chunks)

    fetched_type = resp.headers.get('content-type', '').split(';')[0].strip().lower()

    # The single most common failure for a "public" share link: the host serves
    # an HTML page instead of the file. Google Drive does this for anything not
    # actually public, and for large files it returns a virus-scan interstitial
    # rather than the bytes. Without this check we'd hand HTML to OnlyFans'
    # converter and surface its opaque "400" — which says nothing about the
    # real cause.
    looks_html = fetched_type in ('text/html', 'application/xhtml+xml')
    if not looks_html:
        head = body[:512].lstrip().lower()
        looks_html = head.startswith(b'<!doctype html') or head.startswith(b'<html')
    if looks_html:
        hint = ''
        host = (urlparse(source_url).hostname or '').lower()
        if 'drive.google.com' in host or 'docs.google.com' in host:
            hint = (' For Google Drive the file must be shared as "Anyone with '
                    'the link", and the URL must be a direct-download form such '
                    'as https://drive.google.com/uc?export=download&id=FILE_ID. '
                    'Large files return a virus-scan interstitial instead of the '
                    'bytes and cannot be fetched this way.')
        raise UploadError(
            'source_url returned an HTML page, not a media file — the link is '
            'probably not publicly downloadable.' + hint,
            stage='fetch', detail={'content_type': fetched_type or None,
                                   'bytes': total})

    if not filename:
        path = urlparse(source_url).path
        filename = os.path.basename(path) or 'upload'
    # A URL path often has no usable extension ("/image/png", "/400"). Give the
    # file one from the served type so the vault item isn't named nonsense.
    if '.' not in os.path.basename(filename):
        ext = mimetypes.guess_extension(fetched_type or '') or ''
        if ext:
            filename = f'{filename}{ext}'
    content_type = content_type or fetched_type

    return upload_media(crm_id, of_user_id, body, filename,
                        content_type=content_type, proxy=proxy, secure=secure)


def media_reference(result):
    """Turn a converter result into the object a post/message body wants.

    Goes in the **`mediaFiles`** array — NOT `media`. Verified live 2026-08-06:
    OnlyFans accepts a post carrying `media: [...]` and silently attaches
    nothing, and the same happens if the object is trimmed down to just
    `{processId}`. All five keys below are required for the media to land:

        {"processId": ..., "host": ..., "thumbId": 1,
         "name": "IMG_2676.HEIC", "extra": "..."}
    """
    if not isinstance(result, dict):
        return None
    if result.get('processId'):
        ref = {'processId': result['processId']}
        for field in ('host', 'name', 'extra', 'thumbId'):
            if result.get(field) is not None:
                ref[field] = result[field]
        return ref
    files = result.get('files') or []
    if files and isinstance(files[0], dict) and files[0].get('id'):
        return files[0]['id']
    return None
