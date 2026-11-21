create or replace function public.capture_operational_events()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if TG_TABLE_NAME='orders' then
    if TG_OP='INSERT' and new.sale_channel='pos' then
      insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
      values(
        new.tenant_id,new.id,'SALE_CREATED','info','Venda criada no PDV',
        jsonb_build_object('total_cents',new.total_cents,'sale_channel',new.sale_channel)
      );
    elsif TG_OP='UPDATE' then
      if old.provider_order_id is null and new.provider_order_id is not null then
        insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
        values(
          new.tenant_id,new.id,'PAYMENT_REQUESTED','info','Cobrança enviada à maquineta',
          jsonb_build_object('provider',new.provider,'provider_order_id',new.provider_order_id,'terminal_id',new.terminal_id)
        );
      end if;
      if old.status is distinct from new.status and new.status='paid' then
        insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
        values(
          new.tenant_id,new.id,'PAYMENT_CONFIRMED','info','Pagamento confirmado',
          jsonb_build_object('provider',new.provider,'provider_order_id',new.provider_order_id,'payment_method',new.payment_method,'paid_at',new.paid_at)
        );
      elsif old.status is distinct from new.status and new.status in ('cancelled','expired') then
        insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
        values(
          new.tenant_id,new.id,'PAYMENT_NOT_COMPLETED','warning','Pagamento não concluído',
          jsonb_build_object('status',new.status,'last_error',new.last_error,'provider_order_id',new.provider_order_id)
        );
      end if;
    end if;
  elsif TG_TABLE_NAME='print_jobs' and TG_OP='UPDATE' and old.status is distinct from new.status then
    if new.status='printed' then
      insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
      values(
        new.tenant_id,new.order_id,'PRINT_CONFIRMED','info','Ticket marcado como impresso',
        jsonb_build_object('print_job_id',new.id,'ticket_id',new.ticket_id,'attempts',new.attempts,'printed_at',new.printed_at)
      );
    elsif new.status='failed' then
      insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
      values(
        new.tenant_id,new.order_id,'PRINT_FAILED','error',coalesce(new.last_error,'Falha de impressão'),
        jsonb_build_object('print_job_id',new.id,'ticket_id',new.ticket_id,'attempts',new.attempts)
      );
    elsif old.status='failed' and new.status='pending' then
      insert into public.system_events(tenant_id,order_id,event_type,severity,message,metadata)
      values(
        new.tenant_id,new.order_id,'PRINT_RETRY','warning','Ticket reenviado para impressão',
        jsonb_build_object('print_job_id',new.id,'ticket_id',new.ticket_id,'attempts',new.attempts)
      );
    end if;
  end if;
  return new;
end $$;

revoke all on function public.capture_operational_events() from public,anon,authenticated;

drop trigger if exists trg_orders_operational_events on public.orders;
create trigger trg_orders_operational_events
after insert or update on public.orders
for each row execute function public.capture_operational_events();

drop trigger if exists trg_print_jobs_operational_events on public.print_jobs;
create trigger trg_print_jobs_operational_events
after update on public.print_jobs
for each row execute function public.capture_operational_events();
