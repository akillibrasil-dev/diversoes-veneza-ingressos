alter table public.orders
  add column if not exists operator_id uuid references public.profiles(id) on delete set null;

alter table public.system_events
  add column if not exists actor_id uuid references public.profiles(id) on delete set null;

create index if not exists orders_operator_idx on public.orders(operator_id, created_at desc);
create index if not exists system_events_actor_idx on public.system_events(actor_id, created_at desc);

create or replace function public.create_pos_order(
  p_tenant_slug text,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_tenant public.tenants;
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_qty int;
  v_total int := 0;
begin
  select * into v_tenant from public.tenants where slug=p_tenant_slug and active=true;
  if not found then raise exception 'tenant_not_found'; end if;
  if not public.is_member(v_tenant.id) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>20 then
    raise exception 'invalid_items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int,0);
    if v_qty<1 or v_qty>50 then raise exception 'invalid_quantity'; end if;
    select * into v_product from public.products
      where id=(v_item->>'product_id')::uuid and tenant_id=v_tenant.id and active=true;
    if not found then raise exception 'product_not_found'; end if;
    v_total := v_total + v_product.price_cents*v_qty;
  end loop;

  insert into public.orders(
    tenant_id,status,total_cents,is_demo,sale_channel,print_status,operator_id
  ) values(
    v_tenant.id,'pending_payment',v_total,v_tenant.demo_mode,'pos','not_required',auth.uid()
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    select * into v_product from public.products
      where id=(v_item->>'product_id')::uuid and tenant_id=v_tenant.id and active=true;
    insert into public.order_items(
      tenant_id,order_id,product_id,product_name,unit_price_cents,quantity,tickets_per_unit
    ) values(
      v_tenant.id,v_order.id,v_product.id,v_product.name,v_product.price_cents,v_qty,v_product.tickets_per_unit
    );
  end loop;

  return jsonb_build_object(
    'id',v_order.id,
    'access_key',v_order.access_key,
    'status',v_order.status,
    'total_cents',v_order.total_cents,
    'demo_mode',v_tenant.demo_mode,
    'payment_request_key',v_order.payment_request_key,
    'operator_id',v_order.operator_id
  );
end $$;
revoke all on function public.create_pos_order(text,jsonb) from public,anon;
grant execute on function public.create_pos_order(text,jsonb) to authenticated;

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
  insert into public.system_events(
    tenant_id,actor_id,device_id,order_id,event_type,severity,message,metadata
  ) values(
    p_tenant,auth.uid(),nullif(left(trim(coalesce(p_device_id,'')),120),''),
    p_order_id,left(trim(p_event_type),120),p_severity,
    nullif(left(trim(coalesce(p_message,'')),500),''),
    coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_system_event(uuid,text,text,uuid,text,text,jsonb) from public,anon;
grant execute on function public.record_system_event(uuid,text,text,uuid,text,text,jsonb) to authenticated;

create or replace function public.capture_operational_events()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if TG_TABLE_NAME='orders' then
    if TG_OP='INSERT' and new.sale_channel='pos' then
      insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
      values(new.tenant_id,new.operator_id,new.id,'SALE_CREATED','info','Venda criada no PDV',jsonb_build_object('total_cents',new.total_cents,'sale_channel',new.sale_channel,'operator_id',new.operator_id));
    elsif TG_OP='UPDATE' then
      if old.provider_order_id is null and new.provider_order_id is not null then
        insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
        values(new.tenant_id,new.operator_id,new.id,'PAYMENT_REQUESTED','info','Cobrança enviada à maquineta',jsonb_build_object('provider',new.provider,'provider_order_id',new.provider_order_id,'terminal_id',new.terminal_id));
      end if;
      if old.status is distinct from new.status and new.status='paid' then
        insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
        values(new.tenant_id,new.operator_id,new.id,'PAYMENT_CONFIRMED','info','Pagamento confirmado',jsonb_build_object('provider',new.provider,'provider_order_id',new.provider_order_id,'payment_method',new.payment_method,'paid_at',new.paid_at));
      elsif old.status is distinct from new.status and new.status in ('cancelled','expired') then
        insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
        values(new.tenant_id,new.operator_id,new.id,'PAYMENT_NOT_COMPLETED','warning','Pagamento não concluído',jsonb_build_object('status',new.status,'last_error',new.last_error,'provider_order_id',new.provider_order_id));
      end if;
    end if;
  elsif TG_TABLE_NAME='print_jobs' and TG_OP='UPDATE' and old.status is distinct from new.status then
    if new.status='printed' then
      insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
      values(new.tenant_id,auth.uid(),new.order_id,'PRINT_CONFIRMED','info','Ticket marcado como impresso',jsonb_build_object('print_job_id',new.id,'ticket_id',new.ticket_id,'attempts',new.attempts,'printed_at',new.printed_at));
    elsif new.status='failed' then
      insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
      values(new.tenant_id,auth.uid(),new.order_id,'PRINT_FAILED','error',coalesce(new.last_error,'Falha de impressão'),jsonb_build_object('print_job_id',new.id,'ticket_id',new.ticket_id,'attempts',new.attempts));
    elsif old.status='failed' and new.status='pending' then
      insert into public.system_events(tenant_id,actor_id,order_id,event_type,severity,message,metadata)
      values(new.tenant_id,auth.uid(),new.order_id,'PRINT_RETRY','warning','Ticket reenviado para impressão',jsonb_build_object('print_job_id',new.id,'ticket_id',new.ticket_id,'attempts',new.attempts));
    end if;
  end if;
  return new;
end $$;
revoke all on function public.capture_operational_events() from public,anon,authenticated;

create or replace function public.admin_order_detail(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  o public.orders;
  op jsonb;
  its jsonb;
  pays jsonb;
  tks jsonb;
  jobs jsonb;
  evs jsonb;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.has_role(o.tenant_id,'owner') then raise exception 'forbidden'; end if;

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
