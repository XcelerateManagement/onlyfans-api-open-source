## What and why

<!-- What changes, and what problem it solves. Link the issue if there is one. -->

Closes #

## How it was tested

<!-- Platform (OnlyFans / Fansly), deployment type, and what you actually ran.
     Screenshots for dashboard changes. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`) — see [CONTRIBUTING.md](../CONTRIBUTING.md#sign-your-commits-dco)
- [ ] `pytest tests/` passes
- [ ] This adds no telemetry, no phone-home, no licence check, and no default pointing
      at `theonlyapi.com` or `xcelerator.agency`
- [ ] This adds no metering, usage counting or slot logic
- [ ] This does not assume more than one API worker process
      (`gunicorn.conf.py` enforces one)
- [ ] No creator usernames, `crm_id`s, fan identifiers, message bodies or API keys
      appear in the diff, the tests or the commit messages
