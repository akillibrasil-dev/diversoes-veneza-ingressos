create or replace function public.service_point_checkout_context(
  p_order_id uuid,p_access_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.orders; c public.payment_connections; its jsonb;
begin
  select * into o from public.orders
  where id=p_order_id and access_key=p_access_key and sale_channel='pos';
  if not found then raise exception 'order_not_found'; end if;
  if o.status<>'pending_payment' then raise exception 'order_not_pending'; end if;

  select * into c from public.payment_connections
  where tenant_id=o.tenant_id and status='connected';
  if not found then raise exception 'mp_not_connected'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',oi.id,'title',oi.product_name,'quantity',oi.quantity,
    'unit_price_cents',oi.unit_price_cents,'tickets_per_unit',oi.tickets_per_unit
  ) order by oi.created_at),'[]'::jsonb)
  into its from public.order_items oi where oi.order_id=o.id;

  return jsonb_build_object(
    'tenant_id',o.tenant_id,'order_id',o.id,'total_cents',o.total_cents,
    'payment_request_key',o.payment_request_key,'access_token',c.access_token,
    'refresh_token',c.refresh_token,'expires_at',c.expires_at,'items',its
  );
end $$;

create or replace function public.service_mark_point_created(
  p_order_id uuid,p_provider_order_id text,p_terminal_id text,p_raw jsonb
) returns boolean
language plpgsql security definer set search_path=public as $$
declare o public.orders;
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status<>'pending_payment' then raise exception 'order_not_pending'; end if;
  update public.orders set provider='mercadopago',provider_order_id=p_provider_order_id,
    terminal_id=p_terminal_id,last_error=null where id=p_order_id;
  insert into public.payments(tenant_id,order_id,provider,provider_payment_id,status,amount_cents,raw)
  values(o.tenant_id,o.id,'mercadopago',p_provider_order_id,'created',o.total_cents,p_raw)
  on conflict(provider,provider_payment_id) do update set
    status='created',raw=excluded.raw,updated_at=now();
  return true;
end $$;

create or replace function public.service_confirm_point_order(
  p_external_reference text,p_provider_order_id text,p_status text,p_status_detail text,
  p_paid_amount_cents integer,p_payment_reference text,p_payment_method text,p_raw jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.orders; n int;
begin
  select * into o from public.orders where id=p_external_reference::uuid for update;
  if not found then raise exception 'order_not_found'; end if;

  insert into public.payments(tenant_id,order_id,provider,provider_payment_id,status,amount_cents,raw)
  values(o.tenant_id,o.id,'mercadopago',p_provider_order_id,p_status,p_paid_amount_cents,p_raw)
  on conflict(provider,provider_payment_id) do update set
    status=excluded.status,amount_cents=excluded.amount_cents,raw=excluded.raw,updated_at=now();

  update public.orders set provider='mercadopago',provider_order_id=p_provider_order_id,
    payment_method=nullif(p_payment_method,''),
    last_error=case when p_status in ('failed','canceled','expired') then coalesce(p_status_detail,p_status) else null end
  where id=o.id;

  if p_status='processed' and p_status_detail='accredited' then
    if p_paid_amount_cents<>o.total_cents then raise exception 'amount_mismatch'; end if;
    if o.status<>'paid' then
      update public.orders set status='paid',paid_at=now(),print_status='pending' where id=o.id;
    end if;
    n:=public._ensure_print_jobs(o.id);
    return jsonb_build_object('status','paid','print_status','pending','new_print_jobs',n,'payment_reference',p_payment_reference);
  elsif p_status in ('failed','canceled','expired') then
    update public.orders set status=case when p_status='expired' then 'expired'::public.order_status else 'cancelled'::public.order_status end
    where id=o.id and status='pending_payment';
  end if;

  return jsonb_build_object('status',p_status,'status_detail',p_status_detail);
exception when invalid_text_representation then raise exception 'invalid_external_reference';
end $$;

create or replace function public.service_connection_by_provider_user(p_provider_user_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.payment_connections;
begin
  select * into c from public.payment_connections
  where provider='mercadopago' and status='connected' and provider_user_id=p_provider_user_id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('tenant_id',c.tenant_id,'access_token',c.access_token,
    'refresh_token',c.refresh_token,'expires_at',c.expires_at);
end $$;

revoke all on function public.service_point_checkout_context(uuid,text) from public,anon,authenticated;
revoke all on function public.service_mark_point_created(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.service_confirm_point_order(text,text,text,text,integer,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.service_connection_by_provider_user(text) from public,anon,authenticated;

grant execute on function public.service_point_checkout_context(uuid,text) to service_role;
grant execute on function public.service_mark_point_created(uuid,text,text,jsonb) to service_role;
grant execute on function public.service_confirm_point_order(text,text,text,text,integer,text,text,jsonb) to service_role;
grant execute on function public.service_connection_by_provider_user(text) to service_role;
