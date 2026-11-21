# Checklist de testes — PDV físico

## Já validado em banco

- criação de venda no PDV;
- cálculo de preço no servidor;
- geração exata de um ticket por ingresso;
- idempotência da aprovação de pagamento;
- criação de fila persistente de impressão;
- falha de impressão mantém a venda como paga;
- reset e reimpressão não criam nova cobrança;
- conclusão da venda após todos os tickets serem marcados como impressos.

## Já validado em build/deploy

- build de produção Next.js/TypeScript;
- `/` redireciona para `/pdv`;
- `/pdv` responde HTTP 200;
- `/status` responde HTTP 200;
- `/api/status` confirma aplicação, banco, catálogo, Point Orders e impressão física ativos.

## Pendente de hardware/conta real

1. Conectar a conta Mercado Pago do parque por OAuth.
2. Listar e selecionar a Point real.
3. Colocar a Point em modo PDV.
4. Enviar cobrança real de valor mínimo controlado.
5. Confirmar retorno `processed/accredited` via webhook e polling.
6. Confirmar que o ticket só entra na fila depois do pagamento aprovado.
7. Informar modelo, IP e protocolo da impressora térmica.
8. Testar impressão/corte físico e falta de papel/offline.
9. Testar reimpressão após falha sem nova cobrança.
10. Desativar modo demonstração apenas após os testes anteriores.
