# Diversões Veneza — PDV e Tickets Físicos

MVP white-label de ponto de venda para parque de diversões, desenvolvido pela Akilli Brasil.

## Arquitetura operacional

1. Operador usa o PDV no tablet Android.
2. Seleciona produtos/quantidades.
3. O backend calcula o valor no banco e cria a venda.
4. A cobrança é enviada à maquineta Mercado Pago Point pela Orders API.
5. O cliente paga na maquineta por cartão ou Pix/QR quando suportado.
6. Webhook do Mercado Pago é a confirmação principal; polling do PDV funciona como contingência.
7. Só após pagamento `processed/accredited` o backend gera os tickets físicos.
8. Cada ingresso gera um ticket separado e uma unidade na fila de impressão.
9. Se a impressão falhar, a venda continua paga e o ticket pode ser reimpresso sem nova cobrança.

## Stack

- Next.js + TypeScript
- Supabase (PostgreSQL + Auth + RLS)
- Vercel
- Mercado Pago Point via Orders API
- OAuth Mercado Pago para o parque conectar a própria conta sem entregar senha à Akilli

## Rotas principais

- `/pdv` — operação de vendas no tablet
- `/imprimir/[id]` — fila e impressão de tickets físicos
- `/login` — acesso da equipe
- `/admin` — produtos, vendas e conexão Mercado Pago
- `/status` — diagnóstico técnico

Rotas `/online`, `/pedido/[id]` e `/portaria` permanecem apenas como trilha experimental do protótipo digital e não compõem o fluxo operacional atual do cliente.

## Impressão

O MVP gera layout para impressora térmica de 80 mm, um ticket por ingresso. A confirmação de impressão fica separada do pagamento. O próximo passo de hardware é substituir a confirmação manual pelo bridge ESC/POS específico da impressora escolhida, preservando a mesma fila e o mesmo mecanismo de reimpressão.

## Mercado Pago Point

A implementação segue a Orders API atual do Mercado Pago Point:

- listar terminais: `GET /terminals/v1/list`
- criar cobrança: `POST /v1/orders`, `type=point`
- consultar: `GET /v1/orders/{id}`
- idempotência: `X-Idempotency-Key`
- webhook: evento `Order (Mercado Pago)`

O terminal é enviado em `config.point.terminal_id`. O sistema usa `print_on_terminal=no_ticket`, porque o ingresso é impresso na impressora térmica separada do comprovante da maquineta.

## Segurança e consistência

- preços calculados no banco;
- isolamento por tenant;
- RLS;
- tokens Mercado Pago só no backend;
- idempotência de pagamento;
- emissão de tickets idempotente;
- fila de impressão persistente;
- falha de impressão nunca reabre cobrança;
- webhook HMAC disponível para produção.
