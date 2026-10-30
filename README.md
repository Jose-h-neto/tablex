# Tablex

Transforma mensagens de clientes em uma planilha de movimentações no modelo oficial de importação
(`movimento_variavel_imp.xlsx`).

Cole as mensagens, clique em "Gerar planilha", edite na tela e exporte. O que a mensagem não informa fica vazio.

## Executar

```bash
npm install
npm run dev
npm test
npm run build
```

## Como funciona

- A planilha é montada de uma vez, por regras determinísticas (sem IA).
- A coluna "Da mensagem" mostra o trecho de origem de cada linha e não vai para o arquivo.
- "Ver mensagem" abre o texto original ao lado e destaca a linha da célula em foco.
- O que você digita fica aprendido: empresa vale para todas as linhas, rubrica para as do mesmo tipo e
  "Fixar valor?" para as linhas fixas. Na próxima vez já vem preenchido.
- Linhas repetidas entre mensagens saem da tabela e podem ser recolocadas no topo.
- Linhas sem rubrica e sem valor (pedidos como "checar as extras") ficam na tela, mas não entram no arquivo.

## Privacidade

Tudo roda no navegador, sem chamadas externas (a build de produção impõe isso via CSP). Só o que foi aprendido
(empresa, rubricas e valor de "fixo") é salvo no navegador. Mensagens e lançamentos ficam na memória da aba.

## Código

| Arquivo | Responsabilidade |
|---|---|
| `src/engine/MessageParser.ts` | Separa mensagens, seções, funcionários e sub-itens |
| `src/engine/MovementClassifier.ts` | Identifica o tipo e o valor de cada trecho |
| `src/engine/MovementNormalizer.ts` | Números, `4h45`, períodos e intervalos de horário |
| `src/engine/sheet.ts` | Monta a planilha e aplica as edições |
| `src/export/ExcelExporter.ts` | Preenche o modelo oficial |
| `src/ui/` | Tela de colar e planilha editável |

Padrões analisados e pontos a confirmar: [docs/ANALISE.md](docs/ANALISE.md).
