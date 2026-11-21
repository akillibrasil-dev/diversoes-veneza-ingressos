create or replace function public.internal_validate_owner_setup(
  p_secret text,
  p_tenant_slug text,
  p_setup_code text
) returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
declare t public.tenants;
begin
  if not public.internal_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  select * into t from public.tenants where slug=p_tenant_slug and active=true for update;
  if not found then return false; end if;
  if t.owner_setup_completed_at is not null or t.owner_setup_token_hash is null then return false; end if;
  return encode(extensions.digest(coalesce(p_setup_code,''),'sha256'),'hex')=t.owner_setup_token_hash;
end $$;

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

  insert into public.audit_logs(tenant_id,actor_id,action,entity_type,entity_id,metadata)
  values(t.id,p_user_id,'PRIMARY_OWNER_ACTIVATED','tenant',t.id::text,
         jsonb_build_object('email',lower(trim(p_email))));

  return jsonb_build_object('ok',true,'tenant_id',t.id,'user_id',p_user_id);
end $$;
