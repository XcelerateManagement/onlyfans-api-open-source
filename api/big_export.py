"""Generic full-history export launcher.
  EXPORT_MAX_CHATS=30000 EXPORT_MAX_RUNTIME_SECONDS=172800 venv/bin/python big_export.py <crm_id> <of_user_id>
Writes the job into the shared crm_data.db (visible in the dashboard) and the
ZIP into exports/<crm_id>/<job_id>.zip when done.
"""
import sys
import uuid
import config
import crm_database as db
import export_runner

CRM = sys.argv[1]
OFUID = sys.argv[2]

print(f"caps: MAX_CHATS={config.EXPORT_MAX_CHATS} budget={config.EXPORT_MAX_RUNTIME_SECONDS}s", flush=True)
job_id = uuid.uuid4().hex
db.create_export_job(
    CRM, OFUID, job_id, platform="onlyfans",
    data_types=["account", "subscribers", "transactions", "fans", "earnings", "messages"],
    since=None, until=None, include_media=False,
)
print(f"JOB_ID={job_id}", flush=True)
export_runner.run_export(CRM, OFUID, job_id)
j = db.get_export_job(CRM, job_id)
print(f"FINAL status={j.get('status')} file={j.get('file_path')} size={j.get('file_size')}", flush=True)
print(f"counts={j.get('counts')}", flush=True)
print(f"warnings={j.get('warnings')}", flush=True)
