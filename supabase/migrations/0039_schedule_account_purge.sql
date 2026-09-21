-- Run the 30-day erasure.
--
-- purge_deleted_accounts() is only a promise until something calls it, and the
-- Privacy Policy states the 30 days as fact. pg_cron is the only scheduler
-- this project has — there is no worker process and no external cron — so the
-- database runs it itself, nightly, at an arbitrary minute past three so it is
-- not competing with every other cron job in the world at :00.
--
-- The job runs as postgres, which owns the function; the function is revoked
-- from anon and authenticated, so this schedule is the only caller.
create extension if not exists pg_cron;

select cron.unschedule('purge-deleted-accounts')
 where exists (select 1 from cron.job where jobname = 'purge-deleted-accounts');

select cron.schedule('purge-deleted-accounts', '17 3 * * *',
                     $job$select public.purge_deleted_accounts()$job$);
