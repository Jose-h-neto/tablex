# Tablex — Movimentações de Folha

Converte mensagens de clientes (descontos, substituições, horas extras, faltas, reembolsos…) em lançamentos
conferidos e gera o XLSX no modelo oficial de importação (`movimento_variavel_imp.xlsx`).

Fluxo: **colar mensagens → conferir exceções → exportar**.

## Executar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes do motor de interpretação e do exportador
npm run build      # versão de produção em dist/ (com CSP que bloqueia qualquer conexão externa)
```

## Privacidade

- Tudo roda no navegador. Não há chamadas a APIs, IA, analytics ou telemetria (a build de produção impõe isso via CSP).
- O navegador guarda **apenas configuração**: código da empresa, regras de preenchimento e dicionário de rubricas.
  Mensagens, nomes, matrículas e valores ficam só na memória da aba.
- As mensagens de exemplo do projeto (`src/sample`) e dos testes são anonimizadas.

## Arquitetura

| Módulo | Responsabilidade |
|---|---|
| `src/engine/MessageParser.ts` | Separa mensagens, seções, linhas de funcionário, sub-itens e continuações; detecta competência, correções e repetições |
| `src/engine/MovementClassifier.ts` | Classifica cada trecho e extrai valores, quantidades, datas e recorrência (uma linha pode gerar vários lançamentos) |
| `src/engine/MovementNormalizer.ts` | Números pt-BR, `4h45`, datas sem ano, períodos, intervalos de horário, meses |
| `src/engine/RubricMapper.ts` | Rubrica: edição manual > código citado na mensagem > dicionário. Sem código padrão inventado |
| `src/engine/MovementValidator.ts` | Estados Válido / Atenção / Bloqueado, duplicidades, conflitos entre mensagens, configuração de importação |
| `src/export/ExcelExporter.ts` | Preenche o modelo oficial, valida o cabeçalho e verifica o arquivo gerado antes do download |
| `src/export/PendingReport.ts` | Relatório separado com tudo que não foi exportado |
| `src/ui/` | Split view, tabela editável, ações em lote, configurações |

O motor (`src/engine`, `src/export`, `src/domain`) não depende de React.

## Regras de importação

Ver [docs/ANALISE.md](docs/ANALISE.md): padrões encontrados nas mensagens, regras confirmadas pela planilha real
e pendências que continuam dependendo de confirmação (valor de "fixo", formato de horas, códigos de rubrica).
