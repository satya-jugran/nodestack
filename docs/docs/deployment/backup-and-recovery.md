---
sidebar_position: 3
id: backup-and-recovery
title: Backup & Recovery
description: Safe SQLite backups and disaster recovery
---

Backup & Recovery

Because NodeStack stores all application state inside a single `nodestack_data` directory, disaster recovery and backups are straightforward.

---

## Online SQLite Backups

SQLite WAL mode allows backing up the database file safely while the server is actively handling reads and writes:

### Using SQLite CLI (`.backup`)
```bash
sqlite3 ./nodestack_data/data.db ".backup './backups/backup-$(date +%Y%m%d%H%M).db'"
```

---

## Scheduled Automated Backup Script

A sample cron script (`backup.sh`):

```bash
#!/bin/bash
BACKUP_DIR="/backups/nodestack"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# 1. Vacuum into safe snapshot
sqlite3 /var/data/nodestack/data.db "VACUUM INTO '$BACKUP_DIR/data_$TIMESTAMP.db';"

# 2. Archive storage files
tar -czf "$BACKUP_DIR/storage_$TIMESTAMP.tar.gz" -C /var/data/nodestack/storage .

# 3. Keep only last 14 days
find "$BACKUP_DIR" -type f -mtime +14 -delete
```

---

## Restoring from Backup

1. Stop the NodeStack process:
   ```bash
   sudo systemctl stop nodestack
   ```
2. Replace `data.db` and restore files in `storage/`:
   ```bash
   cp /backups/nodestack/data_20261020.db /var/data/nodestack/data.db
   rm -f /var/data/nodestack/data.db-wal /var/data/nodestack/data.db-shm
   ```
3. Restart the service:
   ```bash
   sudo systemctl start nodestack
   ```
