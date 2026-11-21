alter table public.tenants
  add column if not exists primary_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists owner_setup_token_hash text,
  add column if not exists owner_setup_completed_at timestamptz;

create unique index if not exists memberships_one_active_owner_per_tenant
  on public.memberships(tenant_id)
  where role='owner'::public.app_role and active=true;

create or replace function public.can_administer(_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.memberships m
    where m.user_id=auth.uid()
      and m.tenant_id=_tenant
      and m.active=true
      and m.role in ('owner'::public.app_role,'admin'::public.app_role)
  )
$$;

revoke all on function public.can_administer(uuid) from public,anon;
grant execute on function public.can_administer(uuid) to authenticated;

create or replace function public.owner_can_view_profile(_profile_user uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id=mine.tenant_id
    where mine.user_id=auth.uid()
      and mine.role in ('owner'::public.app_role,'admin'::public.app_role)
      and mine.active
      and theirs.user_id=_profile_user
  )
$$;

create or replace function public.get_my_context()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'user_id',m.user_id,'tenant_id',m.tenant_id,'role',m.role,'active',m.active,
    'tenant_name',t.name,'tenant_slug',t.slug,'demo_mode',t.demo_mode,
    'full_name',p.full_name,'email',p.email,
    'primary_owner_id',t.primary_owner_id
  ) into v
  from public.memberships m
  join public.tenants t on t.id=m.tenant_id
  left join public.profiles p on p.id=m.user_id
  where m.user_id=auth.uid() and m.active=true
  order by case m.role
    when 'owner'::public.app_role then 0
    when 'admin'::public.app_role then 1
    when 'cashier'::public.app_role then 2
    else 3
  end
  limit 1;
  return v;
end $$;

create or replace function public.owner_setup_status(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'tenant_name',t.name,
    'ready',t.owner_setup_completed_at is null and t.owner_setup_token_hash is not null,
    'completed',t.owner_setup_completed_at is not null
  )
  from public.tenants t
  where t.slug=p_tenant_slug and t.active=true
$$;

revoke all on function public.owner_setup_status(text) from public;
grant execute on function public.owner_setup_status(text) to anon,authenticated;

create or replace function public.internal_validate_owner_setup(
  p_secret text,
  p_tenant_slug text,
  p_setup_code text
) returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $
declare t public.tenants;
begin
  if not public.internal_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  select * into t from public.tenants where slug=p_tenant_slug and active=true for update;
  if not found then return false; end if;
  if t.owner_setup_completed_at is not null or t.owner_setup_token_hash is null then return false; end if;
  return encode(extensions.digest(coalesce(p_setup_code,''),'sha256'),'hex')=t.owner_setup_token_hash;
end $$;

revoke all on function public.internal_validate_owner_setup(text,text,text) from public;
grant execute on function public.internal_validate_owner_setup(text,text,text) to anon,authenticated;

create or replace function public.internal_claim_primary_owner(
  p_secret text,
  p_tenant_slug text,
  p_setup_code text,
  p_user_id uuid,
  p_full_name text,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $
declare t public.tenants;
begin
  if not public.internal_secret_ok(p_secret) then raise exception 'forbidden'; end if;

  select * into t from public.tenants where slug=p_tenant_slug and active=true for update;
  if not found then raise exception 'tenant_not_found'; end if;
  if t.owner_setup_completed_at is not null then raise exception 'setup_already_completed'; end if;
  if t.owner_setup_token_hash is null
     or encode(extensions.digest(coalesce(p_setup_code,''),'sha256'),'hex')<>t.owner_setup_token_hash
  then raise exception 'invalid_setup_code'; end if;

  insert into public.profiles(id,full_name,email)
  values(p_user_id,trim(p_full_name),lower(trim(p_email)))
  on conflict(id) do update
    set full_name=excluded.full_name,email=excluded.email,updated_at=now();

  update public.memberships
    set active=false
    where tenant_id=t.id and role='owner'::public.app_role and user_id<>p_user_id;

  insert into public.memberships(user_id,tenant_id,role,active)
  values(p_user_id,t.id,'owner'::public.app_role,true)
  on conflict(user_id,tenant_id) do update
    set role='owner'::public.app_role,active=true;

  update public.tenants
    set primary_owner_id=p_user_id,
        owner_setup_completed_at=now(),
        owner_setup_token_hash=null,
        updated_at=now()
    where id=t.id;

  insert into public.audit_logs(tenant_id,actor_id,action,entity_type,entity_id,details)
  values(t.id,p_user_id,'PRIMARY_OWNER_ACTIVATED','tenant',t.id::text,
         jsonb_build_object('email',lower(trim(p_email))));

  return jsonb_build_object('ok',true,'tenant_id',t.id,'user_id',p_user_id);
end $$;

revoke all on function public.internal_claim_primary_owner(text,text,text,uuid,text,text) from public;
grant execute on function public.internal_claim_primary_owner(text,text,text,uuid,text,text) to anon,authenticated;

create or replace function public.admin_list_users(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v jsonb;
begin
  if not public.can_administer(p_tenant) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,
    'full_name',p.full_name,
    'email',p.email,
    'role',m.role,
    'active',m.active,
    'is_primary_owner',(t.primary_owner_id=m.user_id),
    'created_at',m.created_at
  ) order by
    case m.role
      when 'owner'::public.app_role then 0
      when 'admin'::public.app_role then 1
      when 'cashier'::public.app_role then 2
      else 3
    end,
    coalesce(p.full_name,p.email)
  ),'[]'::jsonb) into v
  from public.memberships m
  join public.tenants t on t.id=m.tenant_id
  left join public.profiles p on p.id=m.user_id
  where m.tenant_id=p_tenant;
  return v;
end $$;

revoke all on function public.admin_list_users(uuid) from public,anon;
grant execute on function public.admin_list_users(uuid) to authenticated;

create or replace function public.admin_set_member_active(
  p_tenant uuid,
  p_user_id uuid,
  p_active boolean
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare caller_role public.app_role; target_role public.app_role; primary_id uuid;
begin
  select role into caller_role from public.memberships
    where tenant_id=p_tenant and user_id=auth.uid() and active=true;
  if caller_role not in ('owner'::public.app_role,'admin'::public.app_role) then raise exception 'forbidden'; end if;

  select m.role,t.primary_owner_id into target_role,primary_id
  from public.memberships m join public.tenants t on t.id=m.tenant_id
  where m.tenant_id=p_tenant and m.user_id=p_user_id;
  if target_role is null then raise exception 'member_not_found'; end if;
  if p_user_id=primary_id or target_role='owner'::public.app_role then raise exception 'primary_owner_protected'; end if;
  if p_user_id=auth.uid() then raise exception 'cannot_change_self'; end if;
  if caller_role='admin'::public.app_role and target_role not in ('cashier'::public.app_role,'staff'::public.app_role)
    then raise exception 'forbidden'; end if;

  update public.memberships set active=p_active
  where tenant_id=p_tenant and user_id=p_user_id;

  insert into public.audit_logs(tenant_id,actor_id,action,entity_type,entity_id,details)
  values(p_tenant,auth.uid(),case when p_active then 'MEMBER_REACTIVATED' else 'MEMBER_DEACTIVATED' end,
         'membership',p_user_id::text,jsonb_build_object('target_role',target_role));

  return true;
end $$;

revoke all on function public.admin_set_member_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.admin_set_member_active(uuid,uuid,boolean) to authenticated;

create or replace function public.owner_set_member_role(
  p_tenant uuid,
  p_user_id uuid,
  p_role public.app_role
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare target_role public.app_role; primary_id uuid;
begin
  if not public.has_role(p_tenant,'owner'::public.app_role) then raise exception 'forbidden'; end if;
  if p_role='owner'::public.app_role then raise exception 'owner_role_reserved'; end if;

  select m.role,t.primary_owner_id into target_role,primary_id
  from public.memberships m join public.tenants t on t.id=m.tenant_id
  where m.tenant_id=p_tenant and m.user_id=p_user_id;
  if target_role is null then raise exception 'member_not_found'; end if;
  if p_user_id=primary_id or target_role='owner'::public.app_role then raise exception 'primary_owner_protected'; end if;
  if p_user_id=auth.uid() then raise exception 'cannot_change_self'; end if;

  update public.memberships set role=p_role,active=true
  where tenant_id=p_tenant and user_id=p_user_id;

  insert into public.audit_logs(tenant_id,actor_id,action,entity_type,entity_id,details)
  values(p_tenant,auth.uid(),'MEMBER_ROLE_CHANGED','membership',p_user_id::text,
         jsonb_build_object('from_role',target_role,'to_role',p_role));

  return true;
end $$;

revoke all on function public.owner_set_member_role(uuid,uuid,public.app_role) from public,anon;
grant execute on function public.owner_set_member_role(uuid,uuid,public.app_role) to authenticated;

drop policy if exists products_auth_read on public.products;
create policy products_auth_read on public.products for select to authenticated
  using(active or public.can_administer(tenant_id));
drop policy if exists products_owner_insert on public.products;
drop policy if exists products_owner_update on public.products;
drop policy if exists products_owner_delete on public.products;
create policy products_admin_insert on public.products for insert to authenticated
  with check(public.can_administer(tenant_id));
create policy products_admin_update on public.products for update to authenticated
  using(public.can_administer(tenant_id)) with check(public.can_administer(tenant_id));
create policy products_admin_delete on public.products for delete to authenticated
  using(public.can_administer(tenant_id));

drop policy if exists attractions_owner_insert on public.attractions;
drop policy if exists attractions_owner_update on public.attractions;
drop policy if exists attractions_owner_delete on public.attractions;
create policy attractions_admin_insert on public.attractions for insert to authenticated
  with check(public.can_administer(tenant_id));
create policy attractions_admin_update on public.attractions for update to authenticated
  using(public.can_administer(tenant_id)) with check(public.can_administer(tenant_id));
create policy attractions_admin_delete on public.attractions for delete to authenticated
  using(public.can_administer(tenant_id));

drop policy if exists payments_owner_read on public.payments;
create policy payments_admin_read on public.payments for select to authenticated
  using(public.can_administer(tenant_id));

drop policy if exists audit_owner_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select to authenticated
  using(public.can_administer(tenant_id));

drop policy if exists printer_settings_owner_insert on public.printer_settings;
drop policy if exists printer_settings_owner_update on public.printer_settings;
drop policy if exists printer_settings_owner_delete on public.printer_settings;
create policy printer_settings_admin_insert on public.printer_settings for insert to authenticated
  with check(public.can_administer(tenant_id));
create policy printer_settings_admin_update on public.printer_settings for update to authenticated
  using(public.can_administer(tenant_id)) with check(public.can_administer(tenant_id));
create policy printer_settings_admin_delete on public.printer_settings for delete to authenticated
  using(public.can_administer(tenant_id));

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated
  using(user_id=(select auth.uid()) or public.can_administer(tenant_id));

create or replace function public.admin_order_detail(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  o public.orders; op jsonb; its jsonb; pays jsonb; tks jsonb; jobs jsonb; evs jsonb;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.can_administer(o.tenant_id) then raise exception 'forbidden'; end if;

  select case when p.id is null then null else jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email) end into op
  from (select 1) x left join public.profiles p on p.id=o.operator_id;

  select coalesce(jsonb_agg(jsonb_build_object('id',oi.id,'product_name',oi.product_name,'unit_price_cents',oi.unit_price_cents,'quantity',oi.quantity,'tickets_per_unit',oi.tickets_per_unit,'created_at',oi.created_at) order by oi.created_at),'[]'::jsonb)
  into its from public.order_items oi where oi.order_id=o.id;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'provider',p.provider,'provider_payment_id',p.provider_payment_id,'status',p.status,'amount_cents',p.amount_cents,'created_at',p.created_at,'updated_at',p.updated_at) order by p.created_at),'[]'::jsonb)
  into pays from public.payments p where p.order_id=o.id;

  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'sequence',t.sequence,'status',t.status,'print_status',t.print_status,'printed_at',t.printed_at,'print_attempts',t.print_attempts,'created_at',t.created_at,'product_name',oi.product_name) order by oi.created_at,t.sequence),'[]'::jsonb)
  into tks from public.tickets t join public.order_items oi on oi.id=t.order_item_id where t.order_id=o.id;

  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'ticket_id',j.ticket_id,'status',j.status,'attempts',j.attempts,'last_error',j.last_error,'requested_at',j.requested_at,'printed_at',j.printed_at) order by j.created_at),'[]'::jsonb)
  into jobs from public.print_jobs j where j.order_id=o.id;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'severity',e.severity,'message',e.message,'device_id',e.device_id,'metadata',e.metadata,'created_at',e.created_at,'actor',case when pr.id is null then null else jsonb_build_object('id',pr.id,'full_name',pr.full_name,'email',pr.email) end) order by e.created_at),'[]'::jsonb)
  into evs from public.system_events e left join public.profiles pr on pr.id=e.actor_id where e.order_id=o.id;

  return jsonb_build_object(
    'order',jsonb_build_object('id',o.id,'status',o.status,'total_cents',o.total_cents,'buyer_name',o.buyer_name,'buyer_email',o.buyer_email,'buyer_phone',o.buyer_phone,'provider',o.provider,'provider_order_id',o.provider_order_id,'provider_payment_id',o.provider_payment_id,'payment_method',o.payment_method,'sale_channel',o.sale_channel,'is_demo',o.is_demo,'print_status',o.print_status,'terminal_id',o.terminal_id,'last_error',o.last_error,'created_at',o.created_at,'paid_at',o.paid_at,'completed_at',o.completed_at,'operator_id',o.operator_id),
    'operator',op,'items',its,'payments',pays,'tickets',tks,'print_jobs',jobs,'events',evs
  );
end $$;

revoke all on function public.admin_order_detail(uuid) from public,anon;
grant execute on function public.admin_order_detail(uuid) to authenticated;

-- O código de ativação do proprietário é provisionado por tenant, fora da migration,
-- armazenando apenas SHA-256 em tenants.owner_setup_token_hash.
