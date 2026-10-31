# Nutrify: plano de implementação do marketplace

Ordem de implementação das duas features do schema v5: **vitrine de produtos** e **venda de receitas**. As regras de negócio estão em [`decisoes_marketplace.md`](decisoes_marketplace.md), e os contratos das rotas e dos DTOs no `documentacao-api.html` (seção "Marketplace"). Este documento não repete as regras: diz em que ordem construir, onde fica cada coisa e quando cada etapa está pronta.

- **Data:** 11/10/2026
- **Base já pronta:** schema v5, migrations `20261011151855_novo_escopo` e `20261011160000_restricoes_marketplace` (CHECKs e índice parcial) e limite de requisições por tipo de rota (D9).

## 1. Visão geral

São quatro milestones. Cada uma só depende das anteriores.

| # | Milestone | Entrega | Depende de |
|---|---|---|---|
| M1 | Marketplace: Fundação | Variáveis de ambiente, termos do marketplace, serviço de notificação | Base |
| M2 | Vitrine de Produtos | Categorias, produtos, fotos, listagem e moderação | M1 |
| M3 | Venda de Receitas: Vendedor | Conexão com o Mercado Pago, ofertas, prévia e conteúdo fechado | M1 |
| M4 | Venda de Receitas: Compra | Checkout, webhook, cópia, uso da cópia e reembolso | M3 |

M2 e M3 não dependem uma da outra e podem andar em paralelo. A vitrine não usa o Mercado Pago, então é o melhor ponto de partida.

```
Base ── M1 ─┬─ M2 (vitrine)
            └─ M3 (vendedor) ── M4 (compra)
```

## 2. Onde fica cada coisa

Os módulos novos seguem a organização atual de `src/modules`, por domínio:

| Pasta | Conteúdo |
|---|---|
| `src/modules/marketplace/termos` | Termos do marketplace e a verificação de aceite |
| `src/modules/marketplace/categoria` | CRUD de `CategoriaProduto` (padrão de `nutricao/unidade-medida`) |
| `src/modules/marketplace/produtos` | Agregador da vitrine, com os submódulos `produto`, `produto-midia` e `produto-denuncia` |
| `src/modules/marketplace/recebedor` | OAuth do Mercado Pago, `ContaRecebedor` e renovação de token |
| `src/modules/marketplace/mercado-pago` | Cliente do Mercado Pago (preferência do Checkout Pro, consulta de pagamento) e webhook |
| `src/modules/receitas/oferta` | `ReceitaOferta` e público-alvo |
| `src/modules/receitas/compra` | `ReceitaCompra`, cópia, compradas, vendas e reembolso |
| `src/common/notificacao` | Serviço que cria `Notificacao`, usado pelos dois lados |

Pontos do código atual que vão ser alterados:

- `src/modules/receitas/receita/receita.service.ts` e `receita.controller.ts`: receitas pagas fora das listagens gratuitas, prévia no detalhe, `403` em `/ingredientes` e as rotas `POST /paga`, `PATCH /:id/oferta` e `GET /a-venda`.
- `src/modules/receitas/visibilidade/`: a cópia de compra e a receita à venda entram nas regras de visibilidade.
- `src/modules/receitas/adaptacao/adaptacao-catalogo.service.ts`: não adaptar receita à venda (P6).
- `src/modules/acompanhamento/plano-alimentar/`: aceitar a cópia que o próprio paciente comprou (P10).
- `src/common/multer/multer.module.ts`: campo novo para as fotos de produto.
- `src/common/config/env.validation.ts` e `.env.example`: variáveis novas.

## 3. M1: Marketplace: Fundação

### 3.1 Variáveis de ambiente

- Acrescentar ao `env.validation.ts` as variáveis da seção 10 das decisões. As de Mercado Pago (`MP_*`) e `RECEBEDOR_TOKEN_KEY` ficam opcionais até a M3, para não quebrar o ambiente de quem ainda não tem conta de teste.
- `MARKETPLACE_TAXA_PERCENTUAL` e `MARKETPLACE_PRECO_MINIMO` ganham um valor provisório no `.env.example` até o time decidir (D7).
- `MARKETPLACE_REEMBOLSO_DIAS` com padrão `7`.

**Pronto quando:** a API sobe com e sem as variáveis de Mercado Pago, e o `.env.example` lista todas.

### 3.2 Termos do marketplace

- `GET /api/marketplace/termos` e `POST /api/marketplace/termos/aceite`, gravando em `ConsentimentoLgpd` com `termos_marketplace`, a versão de `MARKETPLACE_TERMOS_VERSAO` e o IP.
- Um `TermosMarketplaceService.garantirAceite(usuarioId)` exportado pelo módulo, que lança `422` quando não há aceite da versão atual. Compra, oferta e produto chamam esse método.

**Pronto quando:** o aceite da versão atual libera, a troca de versão volta a exigir aceite e um teste cobre os dois casos.

### 3.3 Serviço de notificação

Hoje nenhum código grava `Notificacao`. O marketplace precisa de quatro tipos (seção 8 das decisões).

- Migration com `INSERT` dos códigos `receita_vendida`, `compra_liberada`, `reembolso_resolvido` e `produto_removido` em `tipos_notificacao`.
- `NotificacaoService.criar(...)` que recebe o código e uma única referência, respeitando o arco exclusivo.
- Rotas de leitura das notificações ficam fora deste plano.

**Pronto quando:** o serviço grava uma notificação com `produtoId` sem violar `chk_notificacao_exclusive_arc`.

## 4. M2: Vitrine de Produtos

### 4.1 Categorias de produto

- `GET /api/marketplace/categorias` (login), `POST`, `PATCH`, `DELETE` e `PATCH /:id/restaurar` (admin).
- Desativar em vez de excluir, como em `UnidadeMedida`.

### 4.2 CRUD de produto

- `POST /api/produto`: só `comum` e `paciente`; `profissional` e `admin` recebem `403` (D5, P14). Exige termos (3.2).
- O telefone de contato precisa ser do próprio vendedor. Cidade e UF são copiadas do endereço dele, nunca o endereço inteiro.
- `PATCH /api/produto/:id`: o vendedor muda dados e status entre `ativo`, `pausado` e `vendido`. `removido` não volta.
- `DELETE /api/produto/:id`: só o vendedor. A moderação usa `PATCH /api/produto/:id/remover`.
- Público-alvo declarado, sem a checagem `seguraPara` (P3).
- `GET /api/produto/meus`: produtos do usuário em qualquer status.

### 4.3 Fotos

- `POST /api/produto/:id/midias` e `DELETE /api/produto/:id/midias/:midiaId`, só o vendedor.
- Novo campo no `multer.module.ts`, gravando em `uploads/produtos`.

### 4.4 Listagem e detalhe

- `GET /api/produto/page/:page/limit/:limit` com os filtros `categoria`, `estado`, `cidade`, `publicoAlvo` e `q`. Só status `ativo` e com telefone de contato.
- `GET /api/produto/:id` com `OptionalAuthGuard`: o telefone só vem com token.

### 4.5 Denúncias e moderação

- `POST /api/produto/:id/denuncia`: uma por usuário e produto, nunca o próprio.
- `GET /api/produto/denuncias` e `PATCH /api/produto/denuncias/:denunciaId` (admin). Procedente remove o produto e fecha as outras denúncias abertas dele.
- `PATCH /api/produto/:id/remover` (admin), sem denúncia.
- Os dois caminhos de remoção disparam `produto_removido` (3.3).

**M2 pronta quando:** um `comum` publica um produto com foto, ele aparece na listagem filtrada, o telefone só aparece logado, e uma denúncia procedente o remove e notifica o vendedor.

## 5. M3: Venda de Receitas: Vendedor

Pré-requisito externo: aplicação de teste no Mercado Pago e duas contas de teste (vendedor e comprador). Não usa dinheiro real.

### 5.1 Conexão com o Mercado Pago

- `GET /api/recebedor/conectar` devolve a URL de autorização com um `state` assinado, ligado ao usuário.
- `GET /api/recebedor/callback` (público) confere o `state`, troca o `code` pelos tokens e cria ou reativa `ContaRecebedor`.
- Tokens cifrados com `RECEBEDOR_TOKEN_KEY` (AES-256-GCM pelo `crypto` do Node) e nunca devolvidos.
- `GET /api/recebedor/me` e `DELETE /api/recebedor`.

### 5.2 Renovação do token

- Instalar `@nestjs/schedule`. Um job diário renova pelo refresh token as contas cujo `tokenExpiraEm` está próximo. Se falhar, marca `desconectado`.

### 5.3 Ofertas

- `POST /api/receita/paga` (`comum`, `paciente`, `admin`; o `profissional` recebe `403`, D4) cria a receita e a oferta na mesma transação; se a oferta for recusada, a receita não é criada (D12, seção 4.2 das decisões).
- Receita gratuita não vira paga (D14): não existe `POST /api/receita/:id/oferta`. Receita paga não vira gratuita (D15): não existe `DELETE`. `PATCH /api/receita/:id/oferta` altera preço e público-alvo ou pausa a oferta. Só o autor; exigem termos e `ContaRecebedor` ativa.
- Preço abaixo de `MARKETPLACE_PRECO_MINIMO` responde `422`.
- Público-alvo validado com a mesma checagem do `filtroSeguraPara` de `visibilidade-receita.service.ts`. Responde `422` listando as recusadas (seção 4.3 das decisões).
- Cópia de compra e adaptação não podem ter oferta (P7).

### 5.4 "À venda", prévia e conteúdo fechado

- Duas funções no módulo de oferta: o filtro "paga" (tem oferta), que as listagens gratuitas usam para excluir, e o filtro "à venda" (as quatro condições da seção 4.1 das decisões), que `/a-venda` usa.
- `GET /api/receita/a-venda` com `publicoAlvo` (rechecado a cada consulta) e `q`.
- Receita com oferta, mesmo pausada, sai de `/all`, `/nome`, `/sugestoes` e `/validadas` (D13). O detalhe devolve a prévia e `/ingredientes` responde `403`. Autor, admin e o curador na fila veem tudo.
- `/alertas` continua aberta (P5).
- A adaptação automática do catálogo ignora receita com oferta (P6).

Esta etapa entra junto com 5.3. Sem ela, criar uma oferta não fecha nada e o conteúdo pago continua público.

**M3 pronta quando:** um vendedor conecta a conta de teste, cria uma receita já com oferta, ela é aprovada, aparece só em `/a-venda` (e não em `/all`) e quem não é autor vê só a prévia. Desconectar a conta tira a oferta do ar.

## 6. M4: Venda de Receitas: Compra

### 6.1 Compra e checkout

- `POST /api/receita/:id/comprar`: exige termos; recusa a própria receita e restrição estrita violada (`422`); com compra `pendente` devolve o mesmo link; com `paga` responde `409`.
- Cria `ReceitaCompra` com `precoPago` e `taxaPlataforma` congelados e uma preferência do Checkout Pro com o token do vendedor e `marketplace_fee`.
- O índice `uq_receita_compra_viva` é a última barreira contra compra dupla; o service trata a violação como `409`.
- `GET /api/receita/compra/:compraId` (só o comprador).

### 6.2 Webhook e cópia

- `POST /api/mercado-pago/webhook` com `@SkipThrottle()`, conferindo `x-signature` com `MP_WEBHOOK_SECRET`, buscando o pagamento na API do Mercado Pago e respondendo `200` rápido.
- Idempotente por `Pagamento.gatewayCobrancaId`.
- Aprovado: em uma transação, cria `Pagamento`, cria a cópia (`Receita` aprovada, com ingredientes e mídias da versão comprada), marca a compra como `paga` e notifica `receita_vendida` e `compra_liberada`.
- Recusado ou expirado: compra `cancelada`.

### 6.3 Acesso à cópia

- `GET /api/receita/:id` de quem comprou devolve a cópia com `compradaDe`. Detalhe e ingredientes gravam `primeiroAcessoEm` na primeira abertura.
- A cópia fica fora das listagens públicas e da curadoria, e ninguém a edita ou exclui (P8).
- `GET /api/receita/compradas` e `GET /api/receita/minhas-vendas`.
- Listagens marcam `oferta.comprada: true` para quem já comprou.

### 6.4 Adaptação e plano alimentar sobre a cópia

- `POST /api/receita/:id/adaptar` funciona sobre a cópia, com resultado privado.
- O plano alimentar aceita a cópia do próprio paciente e recusa a de outro usuário (P10).

### 6.5 Reembolso

- `POST /api/receita/compra/:compraId/reembolso`, uma vez por compra, dentro de `MARKETPLACE_REEMBOLSO_DIAS` contados de `pagaEm`.
- Cópia nunca aberta e fora de plano alimentar: estorno pela API do Mercado Pago; se o estorno não sair inteiro, cai na análise.
- Caso contrário: `reembolso_em_analise`. `GET /api/receita/reembolsos` e `PATCH /api/receita/compra/:compraId/reembolso` (admin).
- `reembolsada` tira do ar a cópia, as adaptações dela e os itens de plano que a usam (P13). Notifica `reembolso_resolvido`.

**M4 pronta quando:** com as contas de teste, um comprador paga uma receita, o webhook libera a cópia, ele a adapta, e um pedido de reembolso sem abertura é estornado automaticamente.

## 7. Testes

- Cada issue traz testes no padrão atual (`*.spec.ts` e `*.integration.spec.ts` ao lado do código).
- O cliente do Mercado Pago fica atrás de uma interface própria, para os testes usarem um dublê em vez da API real.
- Casos que precisam de teste de integração com banco: índice de compra viva, arco exclusivo de `pagamentos` e `notificacoes`, idempotência do webhook e o filtro "à venda".

## 8. Pendências que podem travar

| Pendência | Trava | Até quando |
|---|---|---|
| Valores de comissão e preço mínimo (D7) | Nada; valor provisório no `.env` | Antes de considerar a M3 fechada |
| Conta e aplicação de teste no Mercado Pago | M3 e M4 | Início da M3 |
| ~~Unidade do `marketplace_fee`~~ (resolvido: valor em reais) · prazo de liberação no cartão | 6.5 | Antes do reembolso |
