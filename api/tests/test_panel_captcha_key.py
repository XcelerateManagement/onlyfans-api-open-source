import os, sys, tempfile
os.environ['WERKZEUG_RUN_MAIN']='false'
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY','x'*40); os.environ.setdefault('ENCRYPTION_KEY','y'*40)
os.environ.setdefault('TWOCAPTCHA_API_KEY','server-wide-key-000')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import crm_database as db, crm_api, captcha_solver

db.init_database()
panel = db.create_crm_panel('Captcha Test'); CRM=panel['crm_id']; H={'X-API-Key':panel['api_key']}
c = crm_api.app.test_client()
fails=[]
def check(name, cond, detail=''):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f'  ({detail})' if detail and not cond else ''))
    if not cond: fails.append(name)

# 1. nothing configured -> falls back to the server key
r = c.get(f'/api/crm/{CRM}/settings/captcha', headers=H)
b = r.get_json()
check('GET works', r.status_code==200, r.status_code)
check('starts unconfigured', b.get('configured') is False, b)
check('says it falls back to server key', b.get('falls_back_to_server_key') is True, b)
check('reports server key availability', b.get('server_configured') is True, b)
check('reports login ready through fallback', b.get('ready') is True, b)
check('login uses server key when unset', db.get_panel_captcha_key(CRM) is None)

# 2. a bad key is rejected before storage
captcha_solver.get_balance = lambda k: (_ for _ in ()).throw(Exception('ERROR_WRONG_USER_KEY'))
r = c.put(f'/api/crm/{CRM}/settings/captcha', json={'api_key':'totally-bogus-key'}, headers=H)
check('bad key rejected', r.status_code==400, r.status_code)
check('nothing stored after rejection', db.get_panel_captcha_key(CRM) is None)

# 3. zero balance rejected
captcha_solver.get_balance = lambda k: 0.0
r = c.put(f'/api/crm/{CRM}/settings/captcha', json={'api_key':'valid-but-empty-key'}, headers=H)
check('zero balance rejected', r.status_code==400, r.get_json())

# 4. a good key is stored, encrypted, and never returned
captcha_solver.get_balance = lambda k: 12.34
KEY='panel-own-captcha-key-123456'
r = c.put(f'/api/crm/{CRM}/settings/captcha', json={'api_key':KEY}, headers=H)
check('good key accepted', r.status_code==200, r.get_json())
check('balance reported back', r.get_json().get('balance')==12.34)
check('round-trips correctly', db.get_panel_captcha_key(CRM)==KEY, db.get_panel_captcha_key(CRM))

import sqlite3
raw = sqlite3.connect(os.environ['DATABASE_PATH']).execute(
    'SELECT captcha_api_key FROM crm_panels WHERE crm_id=?', (CRM,)).fetchone()[0]
check('encrypted at rest', KEY not in str(raw), str(raw)[:40])

b = c.get(f'/api/crm/{CRM}/settings/captcha', headers=H).get_json()
check('now configured', b.get('configured') is True)
check('reports login ready through panel key', b.get('ready') is True, b)
check('key itself never returned', KEY not in str(b), str(b))
check('shows a masked preview', b.get('preview') and '…' in b['preview'], b.get('preview'))

# 5. another panel cannot see or change it
other = db.create_crm_panel('Other'); OH={'X-API-Key':other['api_key']}
b2 = c.get(f"/api/crm/{other['crm_id']}/settings/captcha", headers=OH).get_json()
check('other panel is isolated', b2.get('configured') is False, b2)
check("other panel's key unaffected", db.get_panel_captcha_key(CRM)==KEY)

# 6. clearing falls back again
r = c.delete(f'/api/crm/{CRM}/settings/captcha', headers=H)
check('DELETE clears it', r.status_code==200 and db.get_panel_captcha_key(CRM) is None)

# 7. unauthenticated is refused
check('no API key is refused', c.get(f'/api/crm/{CRM}/settings/captcha').status_code in (401,403))

print()
print(f'{len(fails)} FAILURE(S)' if fails else 'ALL PASS')
sys.exit(1 if fails else 0)
