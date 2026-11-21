# Migrations aplicadas no projeto Supabase

Projeto de produção/staging atual: `hoyjtzubnjqfaowvdeye`.

Migrations já aplicadas antes da abertura deste repositório:

- 20261121140713 core_schema
- 20261121140746 rpc_workflows
- 20261121140828 mp_orders_helpers
- 20261121140926 member_bootstrap_helper
- 20261121141223 demo_mode_internal
- 20261121143040 fix_payments_unique_constraint
- 20261121143137 member_invites_and_auth_trigger
- 20261121143332 enable_pg_net_for_bootstrap
- 20261121143749 enable_http_extension_for_auth_setup
- 20261121144000 security_and_index_hardening
- 20261121150510 pos_point_and_printing
- 20261121150530 cashier_role
- 20261121150836 admin_metrics_printed
- 20261121153215 service_role_point_rpcs
- 20261121153359 printer_settings_and_telemetry
- 20261121154857 operational_event_triggers

A partir deste repositório, alterações novas devem ser versionadas em `supabase/migrations/` antes de serem aplicadas.
- `20261121162400_operator_audit_and_order_detail.sql` — operador da venda, ator dos eventos e detalhe administrativo da venda.

- `20261121170000_add_admin_role.sql` — perfil de administrador auxiliar.
- `20261121170100_self_service_users_and_primary_owner.sql` — proprietário principal, ativação única e gestão de equipe.

- `20261121170200_fix_owner_setup_pgcrypto_schema.sql` — corrige resolução do `pgcrypto` no código de ativação.
