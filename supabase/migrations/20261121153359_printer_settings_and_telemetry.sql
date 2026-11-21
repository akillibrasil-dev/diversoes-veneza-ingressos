create table if not exists public.printer_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  mode text not null default 'browser' check (mode in ('browser','escpos_network')),
  paper_width_mm integer not null default 80 check (paper_width_mm in (58,80)),
  host text,
  port integer not null default 9100 check (port between 1 and 65535),
  auto_cut boolean not null default true,
  copies integer not null default 1 check (copies between 1 and 3),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id text,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.printer_settings enable row level security;
alter table public.system_events enable row level security;

drop trigger if exists trg_printer_settings_updated on public.printer_settings;
create trigger trg_printer_settings_updated before update on public.printer_settings
for each row execute function public.touch_updated_at();

create policy printer_settings_member_read on public.printer_settings for select to authenticated
using(public.is_member(tenant_id));
create policy printer_settings_owner_insert on public.printer_settings for insert to authenticated
with check(public.has_role(tenant_id,'owner'));
create policy printer_settings_owner_update on public.printer_settings for update to authenticated
using(public.has_role(tenant_id,'owner')) with check(public.has_role(tenant_id,'owner'));
create policy printer_settings_owner_delete on public.printer_settings for delete to authenticated
using(public.has_role(tenant_id,'owner'));

create policy system_events_member_read on public.system_events for select to authenticated
using(public.is_member(tenant_id));

grant select on public.printer_settings,public.system_events to authenticated;
grant insert,update,delete on public.printer_settings to authenticated;

create index if not exists system_events_tenant_created_idx
on public.system_events(tenant_id,created_at desc);
create index if not exists system_events_order_idx
on public.system_events(order_id);
create index if not exists system_events_severity_idx
on public.system_events(tenant_id,severity,created_at desc);

create or replace function public.record_system_event(
  p_tenant uuid,p_event_type text,p_severity text default 'info',
  p_order_id uuid default null,p_device_id text default null,
  p_message text default null,p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.is_member(p_tenant) then raise exception 'forbidden'; end if;
  if p_severity not in ('info','warning','error','critical') then raise exception 'invalid_severity'; end if;
  insert into public.system_events(tenant_id,device_id,order_id,event_type,severity,message,metadata)
  values(
    p_tenant,nullif(left(trim(coalesce(p_device_id,'')),120),''),
    p_order_id,left(trim(p_event_type),120),p_severity,
    nullif(left(trim(coalesce(p_message,'')),500),''),
    coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_system_event(uuid,text,text,uuid,text,text,jsonb) from public,anon;
grant execute on function public.record_system_event(uuid,text,text,uuid,text,text,jsonb) to authenticated;

create or replace function public.admin_health_summary(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_errors int; v_failed_prints int; v_pending_prints int; v_last jsonb;
begin
  if not public.is_member(p_tenant) then raise exception 'forbidden'; end if;

  select count(*)::int into v_errors
  from public.system_events
  where tenant_id=p_tenant and severity in ('error','critical') and created_at>=now()-interval '24 hours';

  select count(*)::int into v_failed_prints
  from public.print_jobs where tenant_id=p_tenant and status='failed';

  select count(*)::int into v_pending_prints
  from public.print_jobs where tenant_id=p_tenant and status in ('pending','printing');

  select coalesce(jsonb_agg(x),'[]'::jsonb) into v_last
  from (
    select jsonb_build_object(
      'id',id,'event_type',event_type,'severity',severity,'message',message,
      'order_id',order_id,'device_id',device_id,'created_at',created_at
    ) x
    from public.system_events
    where tenant_id=p_tenant
    order by created_at desc
    limit 20
  ) s;

  return jsonb_build_object(
    'errors_24h',v_errors,'failed_print_jobs',v_failed_prints,
    'pending_print_jobs',v_pending_prints,'recent_events',v_last
  );
end $$;
revoke all on function public.admin_health_summary(uuid) from public,anon;
grant execute on function public.admin_health_summary(uuid) to authenticated;

insert into public.printer_settings(tenant_id,mode,paper_width_mm,port,auto_cut,copies)
select id,'browser',80,9100,true,1
from public.tenants where slug='diversoes-veneza'
on conflict(tenant_id) do nothing;
