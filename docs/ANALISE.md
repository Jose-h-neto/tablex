# Análise dos arquivos de referência

## 1. Planilha oficial (`movimento_variavel_imp.xlsx`)

| Item | Valor encontrado |
|---|---|
| Abas | 1 aba: `Planilha1` |
| Linhas | Somente cabeçalho (linha 1). Nenhuma linha de exemplo. |
| Estilo do cabeçalho | Calibri 11 negrito, borda fina nos 4 lados |
| Linhas de dados | Sem estilo, formato numérico ou validação de dados definidos |

Colunas, na ordem exata (A → L):

| Col | Cabeçalho | Uso pela ferramenta |
|---|---|---|
| A | Código empresa | Configuração (obrigatória) |
| B | Matricula | Extraída da mensagem |
| C | Código da Rubrica | Dicionário de rubricas / código citado na mensagem / edição manual |
| D | Quantidade/Valor | Valor monetário ou quantidade (horas, aulas, dias) |
| E | Data do movimento | Derivada da competência conforme regra configurada |
| F | Fixar valor? | Texto configurado para "sim"/"não" |
| G | Observação | Descrição gerada + referências (datas, meses, recorrência) |
| H | CPF do pensionista | Não utilizado (nenhuma mensagem trata de pensão) |
| I | Código da administradora de benefícios | Não utilizado |
| J | Código do produto do benefícios | Não utilizado |
| K | Item do produto do benefício | Não utilizado |
| L | Data demissão | Não utilizado |

### Regras confirmadas pela planilha real preenchida (`LANÇAMENTO DESCONTO SINDICATO_09.2026.xlsx`)

Mesmo cliente das mensagens (as matrículas coincidem). 57 linhas, mesma aba e mesmas 12 colunas do modelo.

| Coluna | Como foi preenchida | Adotado como |
|---|---|---|
| A Código empresa | número (`12345`) | número; digitado na tabela e lembrado |
| B Matricula | número | número |
| C Código da Rubrica | número (`153` = desconto sindicato) | número; `153` já vem para "Desconto sindicato" |
| D Quantidade/Valor | número, formato `0.00` | número com formato `0.00` |
| E Data do movimento | data real, **1º dia da competência** (01/09/2026), formato curto (`mm-dd-yy`, nº 14) | padrão "1º dia"; mesmo formato |
| F Fixar valor? | **vazia** (nenhum lançamento fixo) | "não fixo" = célula vazia |
| G Observação | vazia | vazia |
| H–L | vazias | vazias |

### Pontos a confirmar

Nenhum exemplo documenta estes pontos. A ferramenta não presume: o campo fica vazio ou como está, e pode ser editado.

1. **Código da empresa e rubricas**: documentados apenas `153` (sindicato) e os códigos citados nas mensagens
   (`1005`, `1021`). Os demais são digitados na tabela uma vez e ficam lembrados.
2. **"Fixar valor?" em lançamento fixo**: nenhum exemplo mostra o valor (S? Sim? 1?). Fica vazio até ser digitado.
3. **Horas**: `4h45` é gravado como `4,75`. Confirmar se o sistema espera decimal ou horas.minutos (`4,45`).
4. **Recorrência** ("até dezembro"): a planilha não tem campo de data final; o encerramento é feito no sistema.
5. **Hora extra**: uma linha por intervalo, com a duração bruta; percentual e refeição não são calculados.

## 2. Mensagens de referência

### Estrutura

- Começam com o nome do destinatário (`Carla`, `Beto`, `Beto, bom dia!!!` (nomes trocados)), seguido de saudação.
- A competência aparece às vezes no cabeçalho (`folha 04/2026`, `fechamento da folha 10/2026`).
- Seções com cabeçalho, com ou sem `:` — `Descontos:`, `Substituções:` (com erro de digitação), `Hora Extra`,
  `Faltas:`, `Desconto por falta:`, `Desconto de Coparticipação Convênio`, `Reembolsos:`,
  `ALTERAÇÃO DE SALÁRIO:`, `Alteração carga horária e salário:`, `Acrescentar até o final de dezembro:`,
  `Segue correções:`.
- Cada linha de movimentação: `MATRÍCULA [-] NOME [-|:] DESCRIÇÃO`.
- Linhas de encerramento: `Segue arquivo referente ao consignado mês 08/2026.` (anexo, não processável).

### Variações de separador entre nome e descrição

`NOME - desc`, `NOME -desc`, `NOME- desc`, `NOME  - desc`, `NOME: desc`, `NOME: : desc`,
`NOME  desc` (sem separador: o nome em maiúsculas termina na primeira palavra minúscula).

### Tipos de movimentação identificados

| Padrão | Exemplo (anonimizado) | Interpretação |
|---|---|---|
| Desconto material didático | `R$ 310,20 - desconto material didático` | Desconto, valor |
| Dois descontos na mesma linha | `material didático R$ 267,02 + R$ 577,60 desconto referente a contraturno` | 2 movimentações |
| Coparticipação por mês | `R$ 150,40 (agosto) + R$ 38,90 (setembro)` | 2 descontos com mês de referência |
| Substituição em horas | `Pagar substituição - 4h45 horas`, `10 hotas` | Horas (4h45 = 4,75 h ou 4,45, conforme configuração) |
| Substituição em aulas por nível | `2 aulas substituição Fundamental I + 2 aulas ensino médio` | 2 movimentações (EF I, EM) |
| Falta | `1 falta (09/10)`, `descontar 6 aulas (06/08)`, `Desconto de 5 horas falta` | Dias/aulas/horas; "falta" → dia (inferido) |
| Hora extra por intervalos | `26/09 06:00 as 12:00 / 13/10 07:00 as 09:30` (com quebra de linha) | 1 lançamento por intervalo, duração bruta |
| Complemento de salário | `Complemento de salário de 1 dias (04/05)` | Dias |
| Diferença salarial | `Pagar um diferença de 106,42 de salário` | Valor (sem `R$`) |
| Salário adicional recorrente | `Salário Professor Tutor - R$ 450,00` sob "Acrescentar até o final de dezembro" | Valor fixo até 12 |
| Aula mensalista assumida | `assumiu em 27/04/2026 ... valor de R$ 2500,00 (pagar os dias 27/04 - 30/04)` | Valor mensal + dias proporcionais |
| Ajuste com rubrica explícita | `1005 - HORA AULA PPE - correto 9` (sub-itens de outra linha) | Rubrica citada + quantidade |
| Reembolso | `reembolso de R$ 790,30 ... consignado`, `R$ 130,00 (estacionamentos)` | Provento, valor |

### Casos não importáveis (bloqueados, exigem tratamento manual)

- Alteração salarial/cadastral: `passa a receber o salário R$ 6500,00 + 5%`, `solicitou redução de carga horária`,
  `Alterar a carga horária para 54`.
- Vínculo/empresa: `ela é de outra unidade`.
- Conferência sem dados: `checar as extras`, `checar se tem horas extra no sábado`.
- Dependência externa: `substituindo a licença maternidade ... até o dia do retorno`.
- Valor ausente: `adicionar o salário complementar do contraturno`, `pagar a diferença de abril`.

### Ambiguidades e inconsistências detectadas

- `precisa pagar os dias de março 27/04 - 30/04` → mês citado diverge das datas.
- Mensagens idênticas repetidas (2ª e 3ª; as duas de 08/2026, a segunda com acréscimo).
- Versão corrigida ("Segue correções") altera itens de mensagens anteriores (ex.: segundo desconto de contraturno).
- Mesmo funcionário com grafias diferentes (`Fulana de Tal...` / `FULANA DE TAL...`).
- Caracteres corrompidos no nome (`NOME SOBRENOME¿¿¿¿¿¿¿`).
- Quantidade sem unidade (`Acrescentar 13,5 - Redação Enem`).
- Hora extra: percentual (50%/100%), sábado/domingo e intervalo de refeição não informados.
- Recorrência herdada do cabeçalho de seção ("Acrescentar até o final de dezembro").
- Datas sem ano (`15/10`): o ano é deduzido da competência.

## 3. Regras adotadas

- Nenhum cálculo trabalhista e nenhum valor presumido: o que a mensagem não informa fica vazio.
- Cada linha da tabela mostra o trecho de origem.
- Nenhuma linha some em silêncio: linhas não reconhecidas aparecem na tabela e repetidas podem ser recolocadas.
- Linhas sem rubrica e sem valor não entram no arquivo; o restante entra como está na tela.
