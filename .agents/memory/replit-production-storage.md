---
name: Replit production persistence
description: Replit deployments reset local files across publishes and restarts.
---

Before publishing RARE with user state stored in local JSON files or process memory, require a durable-storage plan or explicit approval to accept the loss of changes on redeploy.

**Why:** Replit's published filesystem resets on publish or restart. Publishing the current file-backed memory, conversation, checkpoint, and update data without a durable store would risk silently losing user changes. The user also requested no destructive data changes and no database migration unless asked.

**How to apply:** Before configuring or publishing a production release, identify the data that must persist and ask the user whether to add durable storage or keep publication paused. Do not migrate or replace a database without explicit authorization.
