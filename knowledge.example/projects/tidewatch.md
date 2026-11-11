---
title: TideWatch (river-level dashboard)
type: project
date: 2025-11
status: shipped
tags: [python, postgresql, dashboard, time-series, alerts]
visibility: public
links: { repo: "https://github.com/example-user/tidewatch", demo: "https://example.com/tidewatch" }
---
# TideWatch (river-level dashboard)

TideWatch is a fictional dashboard that shows live river levels from a handful of public sensors and sends an email-style alert when a level crosses a threshold.

## What it does
- Pulls sensor readings every ten minutes and stores them in PostgreSQL.
- Draws a seven-day chart per sensor and marks readings above the flood threshold.
- Sends an alert when three consecutive readings are above the threshold, which removed most false alarms during testing.

## How it is built
- **Backend:** Python with a small scheduler, `pandas` for cleaning and PostgreSQL for storage.
- **Frontend:** Next.js and a lightweight charting library.
- **Testing:** the data-cleaning code has unit tests for missing readings, duplicated timestamps and sensor drift.

## Results
The team placed second at the fictional Harrowgate Data Dash 2025 with an early version. No production deployment is claimed.
