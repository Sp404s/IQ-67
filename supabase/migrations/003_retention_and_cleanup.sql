-- Удаляем переговорные сессии и связанные сообщения/снимки через 7 дней.
-- Дочерние записи удаляются каскадно через negotiation_sessions.
create or replace function public.cleanup_expired_negotiation_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.negotiation_sessions
  where created_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_negotiation_sessions() from public;
grant execute on function public.cleanup_expired_negotiation_sessions() to postgres;

-- В Supabase pg_cron может быть отключён. В этом случае функция остаётся
-- доступной для ручного запуска, а миграция не блокируется.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema extensions';
    if not exists (select 1 from cron.job where jobname = 'cleanup-negotiation-sessions-weekly') then
      perform cron.schedule('cleanup-negotiation-sessions-weekly', '0 3 * * *', 'select public.cleanup_expired_negotiation_sessions()');
    end if;
  end if;
exception when others then
  raise notice 'pg_cron schedule was not created: %', sqlerrm;
end;
$$;
