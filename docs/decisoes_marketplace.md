# Nutrify: decisões do marketplace (schema v5)

Registro das decisões tomadas sobre as duas features novas do Nutrify: **venda de receitas** e **vitrine de produtos**. Serve de contexto para quem for implementar, pessoa ou IA, sem precisar da conversa em que elas foram tomadas.

- **Data:** 10/10/2026
- **Situação:** decidido e modelado; nada disso está implementado ainda.
- **Arquivos que acompanham este documento:** `schema.prisma` (v5) e `documentacao-api.html` (seção "Marketplace" no guia; as rotas novas levam o selo "Planejado").
- **Natureza do projeto:** fábrica de software com foco em estudo. As pendências jurídicas e fiscais ficam fora do escopo (seção 11).

## 1. Escopo

| Feature | O que é | Papel da plataforma |
|---|---|---|
| Venda de receitas | O autor coloca uma receita à venda, com preço e público-alvo (por exemplo, intolerantes à lactose, para permitir filtro). Quem compra recebe uma cópia do material. | Cobra pelo gateway, fica com uma comissão e libera a cópia. |
| Vitrine de produtos | Classificados no estilo Marketplace do Facebook ou OLX. | Só intermedia: mostra o anúncio e o contato. Sem pagamento, carrinho, estoque nem frete. |

## 2. Decisões do time

Escolhas feitas explicitamente pelo time, com as alternativas que ficaram de fora.

| # | Ponto | Decisão | Alternativas descartadas |
|---|---|---|---|
| D1 | Pagamento da receita | Gateway com split: o valor é dividido entre vendedor e plataforma, e a API é avisada por webhook. A plataforma não guarda saldo de terceiros. | Plataforma recebe tudo e repassa; pagamento fora da plataforma; compra simulada. |
| D2 | Gateway | Mercado Pago, split 1:1. | Asaas (exige conta CNPJ da plataforma e a API coletaria dados pessoais do vendedor); Pagar.me (só para clientes PSP); decidir depois. |
| D3 | Quem compra receita | Qualquer usuário logado. | Só paciente. |
| D4 | Quem vende receita | `comum`, `paciente` e `admin`, com a conta Mercado Pago conectada. O `profissional` não vende. | Qualquer usuário logado; só profissional aprovado. |
| D5 | Quem anuncia produto | `comum` e `paciente`. O `profissional` não anuncia. | Profissional anuncia com termo de aceite; sem restrição. |
| D6 | Uso da receita comprada | Leitura, adaptação e plano alimentar. | Só adaptação; só leitura. |
| D7 | Comissão e preço mínimo | Configuráveis por variável de ambiente; os valores ainda não foram escolhidos. | Percentuais fixos de 10%, 15% ou 20%. |
| D8 | Reembolso | O comprador pede em até 7 dias. Automático se a cópia nunca foi aberta; depois de aberta, análise do admin. | 7 dias sem condição; sempre por análise do admin. |
| D9 | Limite de requisições | Por tipo de rota, com o webhook fora do limite por IP. | Subir o limite global; só liberar o webhook. |
| D10 | Notificação de produto | O vendedor é notificado quando a moderação remove um produto, já na v5. | Deixar para depois. |
| D11 | Termos do marketplace | Aceite obrigatório, registrado na API, antes da primeira compra, venda ou anúncio. | Aceite só para quem vende ou anuncia; sem registro na API. |
| D12 | Receita nova já paga | Pode nascer paga: `POST /api/receita/paga` recebe a receita com o campo `oferta`, e a receita e a oferta nascem juntas, numa transação. Se a oferta for recusada, a receita também não é criada. Assim a receita paga nunca fica pública e gratuita. | Criar a oferta só depois da aprovação, deixando a receita aberta de graça até lá; uma tabela de receitas só para as pagas, que duplicaria curadoria, versões e adaptação. |
| D13 | Onde a receita paga aparece | Só em `GET /api/receita/a-venda`. As listagens gratuitas (`/all`, `/nome`, `/sugestoes`, `/validadas`) não mostram receita com oferta. | Prévia em todas as listagens, com selo de preço (a antiga P4). |
| D14 | Receita gratuita virar paga | Não pode. A receita é paga desde a criação (D12) ou gratuita para sempre. Uma receita que já esteve pública já foi vista, favoritada e adaptada de graça, e fechar o conteúdo depois não desfaz isso. | Permitir a qualquer momento; permitir só enquanto nunca foi publicada (exigiria uma coluna nova para saber disso). |
| D15 | Receita paga virar gratuita | Não pode. A oferta não é removida, só pausada (`ativa: false`), e o conteúdo continua fechado. Quem comprou tem uma cópia no inventário; a original aberta de graça tiraria o sentido da compra. | Remover a oferta quando não há compras, devolvendo a receita ao público (a antiga P9). |

Motivo da D5: o código de ética do nutricionista (Resolução CFN 599/2018, arts. 60 e 63) veda divulgar marcas de alimentos, suplementos e utensílios. Pelo mesmo motivo de ética profissional (CRN), o profissional também não vende receitas (D4).

## 3. Definições de projeto adotadas

Não foram votadas uma a uma. São as escolhas que o `schema.prisma` e a documentação já assumem; foram apresentadas ao time e ninguém contestou. Se o time discordar de alguma, é ela que muda, e o schema e a documentação junto.

| # | Definição |
|---|---|
| P1 | A cópia entregue ao comprador é uma `Receita` comum e privada, no mesmo padrão de `ReceitaAdaptacao`. Por isso `restricoesVioladas`, adaptação e plano alimentar funcionam sobre ela sem modelagem nova. |
| P2 | "Está à venda" não é uma coluna. É a combinação de quatro condições (seção 4.1). |
| P3 | O público-alvo da receita é verificado pela checagem do filtro `seguraPara`. O do produto é só declarado pelo vendedor. |
| P4 | Substituída pela D13: a receita paga fica fora das listagens gratuitas e aparece só em `/a-venda`. |
| P5 | `GET /api/receita/:id/alertas` continua aberta para quem não comprou. Quem tem restrição precisa saber o que a receita contém antes de pagar, mesmo que isso revele o nome dos ingredientes que disparam alerta. |
| P6 | A adaptação automática do catálogo não roda sobre receita à venda. Uma adaptação pública entregaria de graça o conteúdo pago. |
| P7 | Receita que é cópia de uma compra ou adaptação de outra não pode ser colocada à venda. |
| P8 | O vendedor continua como autor (`criadoPor`) da cópia. O acesso do comprador vem de `ReceitaCompra`. Nenhum dos dois edita ou exclui a cópia. |
| P9 | Substituída pela D15: nenhuma oferta é removida, com ou sem compras; só pausada. |
| P10 | No plano alimentar entra só a cópia que o próprio paciente comprou. A cópia de outro usuário, inclusive a do profissional, não entra. |
| P11 | Cobrança pelo Checkout Pro (redirecionamento para o Mercado Pago), e não pelo Checkout Transparente. |
| P12 | Cópia que está em um plano alimentar manda o pedido de reembolso para análise do admin, mesmo que nunca tenha sido aberta. |
| P13 | Reembolso concluído tira do ar a cópia, as adaptações feitas a partir dela e os itens de plano alimentar que a usam. |
| P14 | O admin não anuncia produto; só modera. |
| P15 | Os limites de 120 e 30 requisições por minuto (seção 7) são valores iniciais, ajustáveis com o uso. |
| P16 | O nome do modelo é `Produto`, e não "Anuncio", para não confundir com `Anunciante` e `CampanhaPublicitaria`, que são de publicidade. |

## 4. Venda de receitas

### 4.1 Quando uma receita está à venda

As quatro condições valem ao mesmo tempo:

1. A oferta (`ReceitaOferta`) está `ativa`.
2. A receita está `aprovada` e não foi excluída.
3. O autor tem a conta Mercado Pago conectada (`ContaRecebedor` com status `ativo`).
4. A receita não é cópia de uma compra nem adaptação de outra receita.

Consequências:

- "Paga" e "à venda" são coisas diferentes. Receita **paga** é a que tem oferta, ativa ou pausada: o conteúdo fica fechado e ela sai das listagens gratuitas. Receita **à venda** é a paga que cumpre as quatro condições: aparece em `/a-venda` e pode ser comprada. Pausada, a oferta não aparece em lugar nenhum da listagem, mas o conteúdo continua fechado.
- Editar uma receita aprovada a devolve para `pendente` (regra que já existe). A oferta sai do ar sozinha e volta quando a nova versão for aprovada. Quem já comprou não é afetado.
- Se o vendedor desconectar o Mercado Pago, ou a renovação do token falhar, as ofertas dele saem do ar.
- Criar ou alterar uma oferta com preço abaixo do mínimo responde `422`.

### 4.2 Criação da receita paga

A receita paga nasce paga (D12). `POST /api/receita/paga` recebe a receita com o campo obrigatório `oferta` (`preco` e `restricaoIds`). Só `comum`, `paciente` e `admin` chamam essa rota; o `profissional` recebe `403` (D4). `POST /api/receita` continua criando só receita gratuita.

1. Antes de gravar qualquer coisa, a API confere os termos do marketplace, a conta Mercado Pago ativa e o preço mínimo.
2. Numa transação, cria a receita (`pendente`, como qualquer receita nova) e os ingredientes.
3. Na mesma transação, confere o público-alvo contra os ingredientes recém-gravados, com a checagem do filtro `seguraPara`.
4. Cria a `ReceitaOferta`.

Se qualquer passo falhar, nada é gravado e a resposta é `422`, com o motivo (no caso do público-alvo, as restrições recusadas). Enquanto `pendente`, a receita só é vista pelo autor, pelo admin e pelo curador, então não existe janela em que ela esteja pública e gratuita. A curadoria é a mesma das receitas gratuitas.

O schema não muda: "é paga" é a receita ter `ReceitaOferta`, e o preço fica na oferta.

Uma receita gratuita não vira paga (D14): a oferta só nasce no `POST /api/receita/paga`. A oferta só vai ao ar com a receita `aprovada`. Se a curadoria reprovar, a oferta não é apagada: fica fora do ar, porque a condição 2 da seção 4.1 não vale, e volta se uma nova versão for aprovada.

### 4.3 Público-alvo

- O vendedor informa IDs de `RestricaoAlimentar`.
- A API só aceita uma restrição se a receita for segura para ela, pela mesma checagem do filtro `seguraPara`. Caso contrário responde `422`, listando as restrições recusadas e o motivo.
- O filtro `publicoAlvo` da listagem confere a segurança de novo a cada consulta, porque a curadoria de ingredientes muda depois da criação da oferta.

### 4.4 Prévia e conteúdo fechado

Uma receita com oferta nunca entrega o conteúdo completo nas rotas públicas, mesmo com a oferta pausada.

| Rota | Quem não comprou | Quem comprou |
|---|---|---|
| Listagens gratuitas (`/all`, `/nome`, `/sugestoes`, `/validadas`) | Não aparece | Não aparece (a cópia está em `/compradas`) |
| `GET /api/receita/a-venda` | Prévia, com o campo `oferta` | Prévia, com `oferta.comprada: true` |
| `GET /api/receita/:id` | Prévia | A cópia dele, marcada com `compradaDe` |
| `GET /api/receita/:id/ingredientes` | `403` | Ingredientes da cópia |
| `GET /api/receita/:id/alertas` | Aberta | Aberta |

- **A prévia traz:** nome, descrição, capa, tempo, porções, dificuldade, aviso de contaminação cruzada, `oferta` (preço, público-alvo, `comprada`) e, para o paciente, `restricoesVioladas`.
- **A prévia não traz:** modo de preparo, lista de ingredientes com quantidades, mídias de passo a passo e vídeo.
- **Veem a receita inteira:** o autor, o admin e o profissional que faz a curadoria (na fila de pendentes).

### 4.5 Regras da compra

- Exige o aceite dos termos do marketplace (`422` sem ele).
- Ninguém compra a própria receita (`422`).
- No máximo uma compra viva por comprador e receita. Com uma `pendente`, a rota devolve o mesmo link de pagamento (`200`); com uma `paga`, responde `409`.
- Receita que fere uma restrição **estrita** do comprador não pode ser comprada (`422`, com `restricoesVioladas`). Com restrição flexível, a compra segue e a prévia já mostra o aviso.
- Usuário sem restrições cadastradas (o `comum`, por exemplo) compra sem essa checagem.
- `precoPago` e `taxaPlataforma` ficam gravados na compra. Mudar o preço da oferta ou o percentual depois não altera compras antigas.
- A cópia só é criada quando o Mercado Pago confirma o pagamento pelo webhook.

| Status da compra | Significado | Cópia |
|---|---|---|
| `pendente` | Link de pagamento criado, aguardando pagamento | Não existe |
| `paga` | O Mercado Pago confirmou | Liberada |
| `cancelada` | O pagamento falhou ou expirou; o usuário pode tentar de novo | Nunca existiu |
| `reembolso_em_analise` | O comprador pediu reembolso e o admin ainda não decidiu | Continua liberada |
| `reembolsada` | O valor foi devolvido | Sai do ar |

### 4.6 A cópia

- É uma `Receita` nova, com status `aprovada`, com os ingredientes e as mídias que a original tinha no momento da compra (`versaoComprada`). `ReceitaVersao` não guarda ingredientes, por isso a cópia não é um ponteiro para a versão.
- **Não muda.** Edição posterior da original não chega à cópia. Ela continua existindo se o vendedor pausar a oferta ou excluir a original.
- **Não circula.** Não aparece em listagens públicas nem na fila de curadoria, e não pode ser vendida.
- **Adaptação.** O comprador usa a rota de hoje, `POST /api/receita/:id/adaptar`, sobre a cópia. O resultado é visível só para ele. Para restrição estrita, a adaptação continua precisando da verificação de um profissional.
- **Plano alimentar.** O profissional pode incluir a cópia que o próprio paciente comprou e adaptá-la para ele pelas rotas de sugestão. A checagem de segurança do item é a de hoje (`422` se insegura).

### 4.7 Reembolso

O comprador pede em `POST /api/receita/compra/:compraId/reembolso`, em até 7 dias contados de `pagaEm`. Cada compra aceita um pedido só.

| Situação da cópia | O que acontece |
|---|---|
| Nunca foi aberta e não está em plano alimentar | Estorno automático: a compra fica `reembolsada` e a cópia sai do ar |
| Já foi aberta, ou está em um plano alimentar | A compra fica `reembolso_em_analise` e entra na fila do admin. Aprovado, vira `reembolsada`; negado, volta para `paga` |
| Passaram os 7 dias | `422` |

- **Abrir** é o comprador carregar o conteúdo da cópia: a rota de detalhe ou a de ingredientes. Isso grava `primeiroAcessoEm`. A listagem `/compradas` traz só o resumo e não conta.
- No split do Mercado Pago, o estorno é descontado do vendedor e da plataforma na proporção de cada um. Se o vendedor não tiver saldo, o Mercado Pago não devolve o valor inteiro; o pedido automático cai então na análise do admin.

### 4.8 Integração com o Mercado Pago

- **Conta do vendedor.** Precisa de conta Mercado Pago com identificação completa (nível KYC 6). Dados bancários e documentos ficam só lá.
- **Conexão (OAuth).** `GET /api/recebedor/conectar` devolve a URL de autorização. O Mercado Pago redireciona o vendedor para `GET /api/recebedor/callback` com `code` (válido por 10 minutos) e `state`. A API troca o código pelos tokens e cria `ContaRecebedor` como `ativo`.
- **Tokens.** Gravados cifrados, com a chave fora do banco, e nunca devolvidos por nenhuma rota. O token de acesso vale 180 dias; um job o renova pelo refresh token antes de `tokenExpiraEm`. Se falhar, o status vira `desconectado`.
- **Cobrança.** Cada compra cria uma preferência do Checkout Pro com o token do vendedor e a comissão da plataforma em `marketplace_fee`. A tarifa do Mercado Pago sai da parte do vendedor. A compra guarda `gatewayPreferenciaId` e `checkoutUrl`.
- **Webhook.** `POST /api/pagamento/webhook` confere a assinatura do cabeçalho `x-signature`, busca o pagamento no Mercado Pago e responde `200`. O Mercado Pago espera a resposta por 22 segundos e reenvia a cada 15 minutos se ela não vier. A rota é idempotente por `Pagamento.gatewayCobrancaId`, que é único.
- **Registro do pagamento.** A linha de `Pagamento` nasce no webhook, e não na criação da compra, porque no Checkout Pro o ID do pagamento só existe depois que o comprador paga.

## 5. Vitrine de produtos

- **Quem anuncia:** `comum` e `paciente`. O `profissional` recebe `403`. O admin só modera.
- **Campos:** título, descrição, preço (opcional; sem preço fica "a combinar"), categoria, fotos, cidade, UF, telefone de contato e público-alvo.
- **Contato:** um telefone do próprio vendedor (`telefoneContatoId`). Aparece só para quem está logado e só na rota de detalhe.
- **Localização:** só cidade e UF, copiadas para o produto. O endereço completo do vendedor nunca é exposto.
- **Sem telefone de contato** (o vendedor apagou o número), o produto sai da vitrine até outro ser escolhido.
- **Público-alvo:** declarado pelo vendedor e não verificado. Serve de filtro de busca e não pode ser exibido como "seguro para" uma restrição.
- **Categorias:** tabela `CategoriaProduto`, mantida pelo admin, no mesmo padrão de `UnidadeMedida`.

| Status | Quem define | Na vitrine |
|---|---|---|
| `ativo` | vendedor | Aparece |
| `pausado` | vendedor | Não aparece; pode voltar |
| `vendido` | vendedor | Não aparece |
| `removido` | admin | Não aparece; o vendedor não consegue reverter |

**Moderação**

- Qualquer usuário logado denuncia um produto, uma vez por produto e nunca o próprio.
- O admin resolve a fila. Denúncia procedente deixa o produto `removido` e fecha como procedentes as outras denúncias abertas dele.
- O admin também pode remover direto, sem denúncia.
- Nos dois casos o vendedor recebe a notificação `produto_removido`.

## 6. Termos do marketplace

- Comprar uma receita, criar uma oferta e publicar um produto exigem o aceite da versão atual dos termos. Sem ele, a rota responde `422`.
- O aceite é gravado em `ConsentimentoLgpd`, com o tipo `termos_marketplace`, a versão do documento e o IP.
- Quando a versão muda, o aceite antigo deixa de valer para novas compras, ofertas e anúncios. O que já existe não é afetado.

## 7. Limite de requisições

Substitui o limite único de 10 requisições por minuto por IP.

| Rotas | Limite por IP |
|---|---|
| Leitura (`GET`) | 120 por minuto |
| Escrita (`POST`, `PATCH`, `DELETE`) | 30 por minuto |
| Login | 5 tentativas a cada 15 minutos, como hoje |
| `POST /api/pagamento/webhook` | Sem limite por IP; a proteção é a assinatura do Mercado Pago |

## 8. Modelo de dados (v5)

**Modelos novos**

| Modelo | Papel |
|---|---|
| `ContaRecebedor` | Conexão do vendedor com o Mercado Pago: ID da conta, tokens cifrados, validade e status. Um por usuário. |
| `ReceitaOferta` | Preço e situação (`ativa`) da venda de uma receita. Um por receita. |
| `ReceitaOfertaPublicoAlvo` | N:N entre oferta e `RestricaoAlimentar`. |
| `ReceitaCompra` | A compra: preço e taxa congelados, status, preferência do gateway, cópia entregue e dados do reembolso. |
| `Produto` | O anúncio da vitrine. |
| `ProdutoMidia` | Fotos do produto. |
| `ProdutoPublicoAlvo` | N:N entre produto e `RestricaoAlimentar`. |
| `ProdutoDenuncia` | Denúncia de um produto; uma por usuário e produto. |
| `CategoriaProduto` | Tabela de domínio das categorias. |

**Modelos alterados**

| Modelo | Mudança |
|---|---|
| `Pagamento` | `assinaturaId` passa a ser opcional; entram `receitaCompraId` e `gatewayCobrancaId` (único). Um pagamento é de uma assinatura ou de uma compra, nunca dos dois. |
| `Notificacao` | Entra `produtoId` no arco de referências. |
| `Receita` | Relações `oferta` e `copiaDeCompra`. |
| `Usuario`, `Telefone`, `RestricaoAlimentar` | Só relações novas. |

**Enums**

| Enum | Valores |
|---|---|
| `StatusCompraReceita` (novo) | `pendente`, `paga`, `cancelada`, `reembolso_em_analise`, `reembolsada` |
| `StatusRecebedor` (novo) | `ativo`, `desconectado` |
| `StatusProduto` (novo) | `ativo`, `pausado`, `vendido`, `removido` |
| `StatusDenuncia` (novo) | `aberta`, `procedente`, `improcedente` |
| `TipoConsentimento` (alterado) | ganha `termos_marketplace` |

**SQL manual na migration** (o Prisma não expressa; o texto completo está no cabeçalho do `schema.prisma`)

1. CHECK em `pagamentos`: exatamente um entre `assinatura_id` e `receita_compra_id`.
2. Índice único parcial em `receita_compras (oferta_id, comprador_id)` para os status `pendente`, `paga` e `reembolso_em_analise`. Garante uma compra viva por comprador e oferta sem impedir nova tentativa depois de um cancelamento.
3. CHECK de `notificacoes` refeita para contar 6 colunas, com `produto_id`.

**Códigos novos em `TipoNotificacao`** (tabela de domínio; entram por migration)

| Código | Para quem | Referência |
|---|---|---|
| `receita_vendida` | vendedor | `receitaId` (a original) |
| `compra_liberada` | comprador | `receitaId` (a cópia) |
| `reembolso_resolvido` | comprador | `receitaId` (a original) |
| `produto_removido` | vendedor | `produtoId` |

**Fora do schema, de propósito**

- Dados bancários do vendedor: ficam só no Mercado Pago.
- Percentual de comissão e preço mínimo: variáveis de ambiente.
- Carteira, saldo e saque: não existem, porque o split entrega o dinheiro direto ao vendedor.
- Chat interno: o contato do produto é por telefone.
- A regra "profissional não anuncia": validada na aplicação pelo `tipoUsuario`.

## 9. Rotas novas

Todas com prefixo `/api`. Acesso: **Público**, **Login opcional**, **Login**, ou Login com o papel indicado.

**Termos do marketplace (2)**

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/marketplace/termos` | Login | Versão atual e se o usuário já aceitou |
| POST | `/marketplace/termos/aceite` | Login | Registra o aceite |

**Venda de receitas (15)**

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/recebedor/conectar` | Login | Devolve a URL de autorização do Mercado Pago |
| GET | `/recebedor/callback` | Público | Destino do redirecionamento; troca o código pelos tokens |
| GET | `/recebedor/me` | Login | Situação da conexão |
| DELETE | `/recebedor` | Login | Desconecta; as ofertas saem do ar |
| POST | `/receita/paga` | `comum`, `paciente`, `admin` | Cria a receita já paga; a oferta só nasce aqui |
| PATCH | `/receita/:id/oferta` | Login (autor) | Altera preço, público-alvo ou pausa |
| GET | `/receita/a-venda` | Login opcional | Lista as receitas à venda, como prévia |
| GET | `/receita/minhas-vendas` | Login | Vendas das receitas do usuário |
| POST | `/receita/:id/comprar` | Login | Cria a compra e devolve o link de pagamento |
| GET | `/receita/compradas` | Login | Resumo das cópias do usuário |
| GET | `/receita/compra/:compraId` | Login (comprador) | Situação de uma compra |
| POST | `/receita/compra/:compraId/reembolso` | Login (comprador) | Pede o reembolso |
| GET | `/receita/reembolsos` | admin | Fila de pedidos em análise |
| PATCH | `/receita/compra/:compraId/reembolso` | admin | Aprova ou nega um pedido |
| POST | `/pagamento/webhook` | Público | Recebe os avisos do Mercado Pago |

**Vitrine de produtos (24)**

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| POST | `/produto` | `comum`, `paciente` | Publica um produto; exige os termos |
| GET | `/produto/page/:page/limit/:limit` | Login opcional | Lista paginada dos produtos ativos, com filtros |
| GET | `/produto/meus` | Login | Produtos do usuário, em qualquer status |
| GET | `/produto/opcoes/categorias` | Login | Categorias ativas para o formulário |
| GET | `/produto/opcoes/restricoes` | Login | Restrições alimentares para o formulário |
| GET | `/produto/:id` | Login opcional | Detalhe; o contato só vem com token |
| PATCH | `/produto/:id` | Login (vendedor) | Atualiza ou muda o status |
| PATCH | `/produto/:id/desativar` | Login (vendedor) | Pausa |
| PATCH | `/produto/:id/ativar` | Login (vendedor) | Ativa |
| DELETE | `/produto/:id` | Login (vendedor) | Exclui (soft delete) |
| POST | `/produto/:id/midias` | Login (vendedor) | Envia uma foto |
| DELETE | `/produto/:id/midias/:midiaId` | Login (vendedor) | Remove uma foto |
| POST | `/produto/:id/denuncia` | Login | Denuncia o produto |
| GET | `/produto/denuncias` | admin | Fila de denúncias abertas |
| PATCH | `/produto/denuncias/:denunciaId` | admin | Resolve uma denúncia |
| PATCH | `/produto/:id/remover` | admin | Remove da vitrine, sem depender de denúncia |
| PATCH | `/produto/:id/reativar` | admin | Desfaz a remoção |
| GET | `/marketplace/categorias` | Login | Categorias ativas |
| GET | `/marketplace/categorias/desativadas` | admin | Categorias desativadas |
| GET | `/marketplace/categorias/:id` | Login | Uma categoria ativa |
| POST | `/marketplace/categorias` | admin | Cria uma categoria |
| PATCH | `/marketplace/categorias/:id` | admin | Atualiza uma categoria |
| PATCH | `/marketplace/categorias/:id/restaurar` | admin | Reativa uma categoria |
| DELETE | `/marketplace/categorias/:id` | admin | Desativa uma categoria |

Filtros da listagem de produtos: `categoria`, `estado`, `cidade`, `publicoAlvo` e `q`. Filtros de `/receita/a-venda`: `publicoAlvo` e `q`.

**DTOs novos (11):** `AceiteTermosMarketplaceDto`, `ReceitaOfertaDto`, `UpdateReceitaOfertaDto`, `CreateReembolsoDto`, `ResolverReembolsoDto`, `CreateProdutoDto`, `UpdateProdutoDto`, `CreateProdutoDenunciaDto`, `ResolverProdutoDenunciaDto`, `CategoriaProdutoDto`, `UpdateCategoriaProdutoDto`. Os campos estão na seção de DTOs do `documentacao-api.html`.

## 10. Variáveis de ambiente novas

Os nomes são uma proposta.

| Variável | Para quê |
|---|---|
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` | Aplicação da plataforma no Mercado Pago e o endereço do callback do OAuth |
| `MP_WEBHOOK_SECRET` | Conferir a assinatura das notificações |
| `RECEBEDOR_TOKEN_KEY` | Chave que cifra os tokens dos vendedores no banco |
| `MARKETPLACE_TAXA_PERCENTUAL`, `MARKETPLACE_PRECO_MINIMO` | Comissão da plataforma e menor preço aceito em uma oferta |
| `MARKETPLACE_REEMBOLSO_DIAS` | Prazo do pedido de reembolso (7) |
| `MARKETPLACE_TERMOS_VERSAO` | Versão atual dos termos |

## 11. Fora do escopo e pendências

**Fora do escopo.** O projeto é de estudo, então estes pontos não bloqueiam a implementação. Passariam a valer se o produto fosse a público.

- Texto jurídico dos termos do marketplace. A API só registra o aceite de uma versão.
- Validação jurídica da regra de reembolso. O art. 49 do Código de Defesa do Consumidor dá 7 dias de arrependimento sem distinguir conteúdo digital já acessado.
- Parte fiscal: quem emite nota do quê, na venda e na comissão.

**Pendências de implementação**

- Escolher os valores de `MARKETPLACE_TAXA_PERCENTUAL` e `MARKETPLACE_PRECO_MINIMO`.
- Conferir na referência da API do Mercado Pago: a unidade do `marketplace_fee`, os meios de pagamento aceitos no split e o prazo de liberação do dinheiro. A documentação consultada não deixa isso claro.
- Rodar `npx prisma validate` no schema v5. A validação oficial não pôde ser executada no ambiente em que o schema foi escrito; a estrutura foi conferida só por um verificador próprio.

Como o projeto é de estudo, a integração pode ser desenvolvida com as credenciais e as contas de teste do Mercado Pago, sem dinheiro real.

## 12. Regras que já existem e das quais o marketplace depende

- **Restrição estrita e flexível.** Estrita: tipo `alergia`, ou gravidade `grave`. A receita insegura some das listas e, aberta pelo link, responde `403`. Flexível: a receita aparece com o aviso `restricoesVioladas`.
- **Ingrediente seguro.** Para restrição estrita, falta de vínculo não basta: o ingrediente precisa ter sido revisado por um curador depois da criação da restrição e ter o dado que a regra de nutriente usa.
- **Curadoria.** Receita nova nasce `pendente` e precisa ser aprovada por um profissional. Editar uma receita aprovada a devolve para `pendente`.
- **Adaptação.** A receita adaptada é uma `Receita` comum, ligada à origem por `ReceitaAdaptacao`. A cópia de compra segue o mesmo padrão.
- **Papéis.** `admin`, `profissional`, `paciente` e `comum`. Só o paciente tem restrições cadastradas.
- **Convenções da API.** Rotas sob `/api`; IDs em UUID; `422` para regra de negócio que impede a operação; `409` para conflito; listas simples em `/all` e paginadas em `/page/:page/limit/:limit`.
