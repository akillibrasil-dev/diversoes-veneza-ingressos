# Infraestrutura — Diversões Veneza PDV

## Arquitetura oficial do MVP

- Aplicação: Next.js + TypeScript
- Banco e autenticação: Supabase / PostgreSQL / Auth / RLS
- Hospedagem: Vercel
- Pagamentos presenciais: Mercado Pago Point via Orders API
- Conexão do recebedor: OAuth Authorization Code do Mercado Pago
- Impressão: térmica 80 mm, um ticket físico por ingresso
- Produto: multi-tenant / white-label desde o início

## Ambientes atuais

- Produção Vercel: https://diversoes-veneza-ingressos.vercel.app
- Supabase project ref: `hoyjtzubnjqfaowvdeye`
- Tenant inicial: `diversoes-veneza`
- Modo demonstração: ativo enquanto a conta Mercado Pago real não estiver conectada.

## Fluxo operacional

1. Operador entra em `/pdv` no tablet.
2. Seleciona os ingressos e cria a venda.
3. O backend envia uma Order `type=point` ao terminal Mercado Pago selecionado.
4. O cliente paga na maquineta.
5. Webhook e polling consultam o estado autoritativo da Order no Mercado Pago.
6. Somente em `processed/accredited` a venda muda para paga.
7. O backend gera os tickets e os respectivos `print_jobs`.
8. `/imprimir/[id]` produz um ticket de 80 mm por ingresso.
9. Falha de impressão mantém a venda paga e permite reimpressão sem nova cobrança.

## Persistência de impressão

- `orders.print_status` acompanha o estado geral da impressão.
- `tickets.print_status`, `printed_at` e `print_attempts` acompanham cada ingresso.
- `print_jobs` é a fila persistente de impressão/reimpressão.
- `printer_settings` guarda modo, largura, host/porta e corte automático para a futura ponte ESC/POS.

O modo atual usa impressão pelo navegador. Impressão silenciosa, confirmação de hardware e corte automático real dependem do modelo/IP da impressora e de uma ponte local ESC/POS no tablet ou na rede.

## Telemetria

`system_events` registra eventos operacionais como pagamento, falha de impressão e sincronização. O RPC `admin_health_summary` consolida erros recentes e pendências de impressão para o futuro suporte inteligente.

## Migrations aplicadas no Supabase

1. `core_schema`
2. `rpc_workflows`
3. `mp_orders_helpers`
4. `member_bootstrap_helper`
5. `demo_mode_internal`
6. `fix_payments_unique_constraint`
7. `member_invites_and_auth_trigger`
8. `enable_pg_net_for_bootstrap`
9. `enable_http_extension_for_auth_setup`
10. `security_and_index_hardening`
11. `pos_point_and_printing`
12. `cashier_role`
13. `admin_metrics_printed`
14. `service_role_point_rpcs`
15. `printer_settings_and_telemetry`
16. `operational_event_triggers`

O banco remoto é a referência operacional deste MVP até a consolidação das migrations no repositório GitHub.

## Segurança

- Tokens OAuth do Mercado Pago ficam somente no backend/banco protegido.
- A senha do cliente Mercado Pago nunca transita pela Akilli.
- Preços são recalculados no banco a partir do catálogo.
- Ordem de pagamento usa chave de idempotência persistente.
- Emissão de tickets e criação de `print_jobs` são idempotentes.
- RLS isola tenants e perfis.
- RPCs sensíveis de integração usam `service_role` ou segredo de backend.
- Falha de impressão jamais inicia uma segunda cobrança.

## Credenciais externas ainda necessárias

- `MP_CLIENT_ID`
- `MP_CLIENT_SECRET`
- `MP_WEBHOOK_SECRET` — recomendado antes de produção financeira

Depois de cadastradas, o dono do parque autoriza a própria conta pelo fluxo **Conectar Mercado Pago**. Também será necessário selecionar o terminal Point em modo PDV no painel.
