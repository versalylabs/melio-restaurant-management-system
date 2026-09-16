# Production Deployment Checklist

1. Set a strong `JWT_SECRET` (16+ characters; preferably 32+ random characters).
2. Set `NODE_ENV=production`.
3. Set `FRONTEND_URL` to the real HTTPS frontend origin.
4. Use PostgreSQL for production rather than SQLite.
5. Run `npm run db:generate` and the appropriate Prisma migration/deploy command.
6. Run `npm run build`.
7. Verify `GET /health` returns `status: healthy`.
8. Put HTTPS/TLS in front of the application.
9. Configure automated database backups and a tested restore procedure.
10. Add external error monitoring/log aggregation and hosting-level rate limiting for multi-instance deployments.
11. Never commit `.env` or production credentials.
