# Backup job image (PROPOSED, not built or deployed from here): PostgreSQL 17 client tools matching the production server major,
# plus age (encryption), curl (S3 upload, SigV4) and the GNU tools the scripts use.
# Build from the repository root:  docker build -f scripts/backup/Dockerfile -t sunchaser-pg-backup .
# Run as a Railway cron service in the SAME project as the database (private network, no public TCP proxy).
FROM postgres:17-alpine
RUN apk add --no-cache bash age curl coreutils util-linux findutils openssl
COPY scripts/backup/lib.sh scripts/backup/manifest.sql scripts/backup/pg-backup.sh scripts/backup/restore-verify.sh scripts/backup/fetch-backup.sh /opt/backup/
RUN chmod 0555 /opt/backup/*.sh && mkdir -p /var/backups/sunchaser && chown postgres:postgres /var/backups/sunchaser
USER postgres
# The scripts refuse to write inside a git checkout; /var/backups is outside it. BACKUP_WORK_DIR=/dev/shm keeps plaintext off disk.
ENV BACKUP_OUT_DIR=/var/backups/sunchaser BACKUP_WORK_DIR=/dev/shm
ENTRYPOINT ["/bin/bash", "/opt/backup/pg-backup.sh"]
CMD ["--prune"]
