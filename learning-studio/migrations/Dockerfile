FROM postgres:16-alpine
COPY scripts/learning-studio-schema.sql /schema.sql
COPY learning-studio/migrations/run.sh /run.sh
RUN chmod 0555 /run.sh
CMD ["/run.sh"]
