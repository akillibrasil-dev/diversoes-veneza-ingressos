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
as $$
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
