// scripts/sandbox-mercado-pago.ts
//
// Testa o gateway do Mercado Pago contra o sandbox, sem a compra pronta:
// usa o token de um vendedor já conectado pelo OAuth e chama o
// MercadoPagoService direto. Os tokens nunca são impressos.
//
// Uso:
//   npx ts-node scripts/sandbox-mercado-pago.ts
//     lista os vendedores conectados (user_id do Mercado Pago)
//
//   npx ts-node scripts/sandbox-mercado-pago.ts preferencia <user_id> [valor] [percentual]
//     cria uma preferência de [valor] reais (padrão 100) com [percentual] de taxa
//     (padrão MARKETPLACE_TAXA_PERCENTUAL) e imprime o link
//
//   npx ts-node scripts/sandbox-mercado-pago.ts pagamento <user_id> <payment_id>
//     consulta um pagamento (o payment_id aparece na URL de volta e no painel)
//
//   npx ts-node scripts/sandbox-mercado-pago.ts recentes <user_id>
//     os últimos pagamentos do vendedor, com o status_detail (o motivo da recusa)
//
// Pré-requisitos: API_URL_PUBLICA, FRONT_URL e RECEBEDOR_TOKEN_KEY no .env, e o
// vendedor de teste conectado por GET /api/recebedor/conectar.

import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { MercadoPagoService } from '../src/modules/marketplace/mercado-pago/mercado-pago.service';
import { TokenCriptoService } from '../src/modules/marketplace/recebedor/token-cripto.service';

const prisma = new PrismaClient();
const config = {
  get: (chave: string) => process.env[chave],
} as unknown as ConfigService;
const cripto = new TokenCriptoService(config);
const mercadoPago = new MercadoPagoService(config);

async function listar() {
  const contas = await prisma.contaRecebedor.findMany({
    select: {
      gatewayRecebedorId: true,
      status: true,
      tokenExpiraEm: true,
      usuario: { select: { nome: true } },
    },
  });
  if (contas.length === 0) {
    console.log(
      'Nenhum vendedor conectado. Conecte o vendedor de teste por GET /api/recebedor/conectar.',
    );
    return;
  }
  console.table(
    contas.map((c) => ({
      user_id: c.gatewayRecebedorId,
      usuario: c.usuario.nome,
      status: c.status,
      token_expira_em: c.tokenExpiraEm.toISOString().slice(0, 10),
    })),
  );
}

async function tokenDe(gatewayRecebedorId: string) {
  const conta = await prisma.contaRecebedor.findUnique({
    where: {
      gateway_gatewayRecebedorId: {
        gateway: 'mercado_pago',
        gatewayRecebedorId,
      },
    },
  });
  if (!conta?.accessTokenCifrado) {
    throw new Error(
      `Vendedor ${gatewayRecebedorId} sem token. Rode sem argumentos para listar.`,
    );
  }
  return cripto.decifrar(conta.accessTokenCifrado);
}

async function preferencia(
  gatewayRecebedorId: string,
  valorTexto = '100',
  percentualTexto = process.env.MARKETPLACE_TAXA_PERCENTUAL ?? '15',
) {
  const valor = Number(valorTexto);
  const percentual = Number(percentualTexto);
  const taxa = Math.round(valor * percentual) / 100;
  // Referência nova a cada execução: a mesma chave de idempotência
  // devolveria a preferência anterior.
  const referencia = `sandbox-${Date.now()}`;

  const { id, checkoutUrl } = await mercadoPago.criarPreferencia(
    await tokenDe(gatewayRecebedorId),
    {
      referencia,
      titulo: 'Receita de teste (sandbox)',
      valor,
      taxaPlataforma: taxa,
      expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  );

  console.log(`Preferência:  ${id}`);
  console.log(`Referência:   ${referencia}`);
  console.log(`Valor:        R$ ${valor.toFixed(2)}`);
  console.log(
    `Taxa enviada: R$ ${taxa.toFixed(2)} (marketplace_fee, ${percentual}%)`,
  );
  console.log(
    `\nAbra numa aba anônima, logado como o COMPRADOR de teste:\n${checkoutUrl}`,
  );
}

async function pagamento(gatewayRecebedorId: string, pagamentoId: string) {
  const p = await mercadoPago.buscarPagamento(
    await tokenDe(gatewayRecebedorId),
    pagamentoId,
  );
  console.log(p);
}

/** Direto na API: o gateway não expõe o status_detail, só útil para diagnosticar. */
async function recentes(gatewayRecebedorId: string) {
  const resposta = await fetch(
    'https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10',
    {
      headers: {
        authorization: `Bearer ${await tokenDe(gatewayRecebedorId)}`,
      },
    },
  );
  const corpo = (await resposta.json()) as {
    message?: string;
    results?: Record<string, any>[];
  };
  if (!resposta.ok)
    throw new Error(`${resposta.status} ${corpo.message ?? ''}`);
  if (!corpo.results?.length) {
    console.log('Nenhum pagamento registrado para este vendedor.');
    return;
  }

  console.table(
    corpo.results.map((p) => ({
      id: p.id,
      criado: String(p.date_created).slice(0, 19),
      status: p.status,
      status_detail: p.status_detail,
      meio: `${p.payment_type_id}/${p.payment_method_id}`,
      valor: p.transaction_amount,
      referencia: p.external_reference,
    })),
  );
}

async function main() {
  const [comando, ...args] = process.argv.slice(2);

  if (!comando) return listar();
  if (comando === 'preferencia' && args[0])
    return preferencia(args[0], args[1], args[2]);
  if (comando === 'pagamento' && args[0] && args[1])
    return pagamento(args[0], args[1]);
  if (comando === 'recentes' && args[0]) return recentes(args[0]);

  console.error(
    'Uso: veja o comentário no topo de scripts/sandbox-mercado-pago.ts',
  );
  process.exitCode = 1;
}

main()
  .catch((erro: Error) => {
    console.error(erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
