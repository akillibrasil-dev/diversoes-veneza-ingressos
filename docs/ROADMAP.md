# Roadmap técnico

## MVP atual

- catálogo e carrinho no tablet;
- cálculo de preço no banco;
- Mercado Pago Point via Orders API;
- confirmação por webhook + polling;
- geração idempotente de tickets físicos;
- fila persistente de impressão;
- reimpressão sem nova cobrança;
- painel administrativo;
- telemetria operacional e diagnóstico.

## Próximas etapas sem dependência de hardware

1. Consolidar todo o schema Supabase em migrations versionadas no repositório.
2. Conectar o repositório à esteira de deploy Git/Vercel.
3. Evoluir o painel de suporte para diagnóstico guiado e, depois, suporte inteligente por IA com ferramentas restritas.
4. ✅ Histórico detalhado da venda e trilha de auditoria por operador implementados no painel.

## Dependências externas para fechar o piloto físico

1. Credenciais da aplicação Mercado Pago e autorização OAuth da conta do parque.
2. Identificação do modelo exato da Point usada no piloto.
3. Modelo, IP e protocolo da impressora térmica de 80 mm.
4. Teste presencial de pagamento, corte, falta de papel, impressora offline e reimpressão.

## Regra operacional central

Pagamento e impressão são estados independentes. Uma venda paga nunca volta a exigir cobrança apenas porque a impressão falhou.
