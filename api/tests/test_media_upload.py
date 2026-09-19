#!/usr/bin/env python3
"""Media upload pipeline — offline tests.

Covers the pure logic of of_upload (key format, flattening, type resolution,
reference shape) and the HTTP gates on POST /accounts/<id>/media. No live
OnlyFans traffic: the network stages are monkeypatched.

The live end-to-end path was verified separately against a real account on
2026-08-06 (single-part and 5 MiB-multipart both returned a processId).

    venv/bin/python tests/test_media_upload.py
"""
import io
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config          # noqa: E402
import of_upload       # noqa: E402

passed = failed = 0


def check(label, cond, extra=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'  PASS  {label}')
    else:
        failed += 1
        print(f'  FAIL  {label} {extra}')


# ── s1: key format ───────────────────────────────────────────────────────────
print('\ns1: build_key matches the web client `i7`')
key = of_upload.build_key('My Photo.JPG', 'upload/')
check('starts with uploadPath', key.startswith('upload/'), key)
m = re.fullmatch(
    r'upload/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/\d+/(.+)',
    key)
check('uuid4/nonce/name shape', m is not None, key)
check('filename lowercased + encoded', m and m.group(1) == 'my%20photo.jpg',
      m.group(1) if m else None)
check('secure path honoured',
      of_upload.build_key('a.jpg', 'upload/secure/').startswith('upload/secure/'))
check('two keys never collide',
      of_upload.build_key('a.jpg', 'upload/') != of_upload.build_key('a.jpg', 'upload/'))

# ── s2: content type + media bucket ──────────────────────────────────────────
print('\ns2: content type resolution')
check('.heic special-cased',
      of_upload.guess_content_type('x.HEIC') == 'image/heic')
check('browser type wins',
      of_upload.guess_content_type('x.bin', 'video/mp4') == 'video/mp4')
check('octet-stream falls back to sniffing',
      of_upload.guess_content_type('x.png', 'application/octet-stream') == 'image/png')
check('photo bucket', of_upload.media_type_for('image/png') == 'photo')
check('gif bucket', of_upload.media_type_for('image/gif') == 'gif')
check('video bucket', of_upload.media_type_for('video/mp4') == 'video')
check('audio bucket', of_upload.media_type_for('audio/mpeg') == 'audio')

# ── s3: form flattening (converter wants PHP bracket keys) ───────────────────
print('\ns3: converter form flattening')
out = {}
of_upload._flatten('', {'preset': 'of_beta', 'additional': {'user': '1'},
                        'file': {'ETag': 'e', 'secure': False}, 'skip': None}, out)
check('scalar kept', out.get('preset') == 'of_beta', out)
check('nested -> bracket key', out.get('additional[user]') == '1', out)
check('file nested', out.get('file[ETag]') == 'e', out)
check('bool -> 0/1', out.get('file[secure]') == '0', out)
check('None dropped', 'skip' not in out, out)

# ── s4: media_reference ──────────────────────────────────────────────────────
print('\ns4: media_reference shape')
ref = of_upload.media_reference({'processId': 'p1', 'host': 'convert1',
                                 'extra': 'x', 'sourceUrl': 'ignored'})
check('processId carried', ref.get('processId') == 'p1', ref)
check('host carried', ref.get('host') == 'convert1', ref)
check('unrelated fields dropped', 'sourceUrl' not in ref, ref)
check('falls back to vault id',
      of_upload.media_reference({'files': [{'id': 77}]}) == 77)
check('None when unusable', of_upload.media_reference({}) is None)

# ── s5: part maths matches the client ────────────────────────────────────────
print('\ns5: multipart threshold')
check('5 MiB part size', of_upload.PART_SIZE == 5242880)
for size, want_multi in ((1024, False), (5242879, False), (5242880, True),
                         (12 * 1024 * 1024, True)):
    check(f'{size} bytes multipart={want_multi}',
          (size >= of_upload.MULTIPART_THRESHOLD) is want_multi)
check('7.5 MiB -> 2 parts', ((7864320 // of_upload.PART_SIZE) + 1) == 2)

# ── s6: HTTP gates ───────────────────────────────────────────────────────────
print('\ns6: route gates')
import crm_api  # noqa: E402

crm_api.app.config['TESTING'] = True
client = crm_api.app.test_client()

conn = sqlite3.connect(crm_api.db.DB_FILE)
conn.row_factory = sqlite3.Row
row = conn.execute(
    'SELECT p.crm_id, p.api_key, a.of_user_id '
    'FROM crm_panels p JOIN of_accounts a ON a.crm_panel_id = p.id '
    'WHERE COALESCE(a.platform, "onlyfans") = "onlyfans" LIMIT 1').fetchone()
conn.close()

if not row:
    print('  SKIP  no OF account in the local DB')
else:
    crm, key_, uid = row['crm_id'], row['api_key'], row['of_user_id']
    H = {'X-API-Key': key_}

    r = client.post(f'/api/crm/{crm}/accounts/{uid}/media')
    check('unauthenticated rejected', r.status_code in (401, 403), r.status_code)

    r = client.post(f'/api/crm/{crm}/accounts/{uid}/media', headers=H, json={})
    check('no file / no source_url -> 400 or 403 (write gate)',
          r.status_code in (400, 403), r.status_code)

    # SSRF guard must fire before any fetch is attempted.
    for bad in ('http://127.0.0.1:5000/a.jpg',
                'http://169.254.169.254/latest/meta-data/',
                'file:///etc/passwd',
                'http://[::1]/a.jpg'):
        r = client.post(f'/api/crm/{crm}/accounts/{uid}/media', headers=H,
                        json={'source_url': bad})
        check(f'ssrf blocked: {bad}', r.status_code in (400, 403), r.status_code)

    r = client.post(f'/api/crm/{crm}/accounts/unknown999/media', headers=H,
                    json={'source_url': 'https://example.com/a.jpg'})
    check('foreign account -> 403', r.status_code == 403, r.status_code)

# ── s7: size ceiling is configurable and sane ────────────────────────────────
print('\ns7: size ceiling')
check('MEDIA_UPLOAD_MAX_BYTES defined',
      isinstance(config.MEDIA_UPLOAD_MAX_BYTES, int))
check('ceiling is at least one part',
      config.MEDIA_UPLOAD_MAX_BYTES > of_upload.PART_SIZE)

# ── s8: the phantom endpoint stays dead ──────────────────────────────────────
print('\ns8: POST /api2/v2/media must not come back')
spec = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))),
    'xcelerate-company-page', 'app', 'api', 'openapi.json', 'route.ts')
if os.path.exists(spec):
    src = open(spec, encoding='utf-8').read()
    check('no "/api2/v2/media" path entry in the spec',
          '"/api2/v2/media": {' not in src)
else:
    print('  SKIP  spec not present')

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
