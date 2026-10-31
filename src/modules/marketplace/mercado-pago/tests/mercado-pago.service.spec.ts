/// <reference types="jest" />

import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoService } from '../mercado-pago.service';
import { DadosPreferencia } from '../mercado-pago.types';

const TOKEN = 'APP_USR-token-do-vendedor';
const COMPRA_ID = 'compra-1';

const ENV_PADRAO = {
  API_URL_PUBLICA: 'https://api.exemplo.com',
  FRONT_URL: 'https://app.exemplo.com',
};

function dadosPreferencia(): DadosPreferencia {
  return {
    referencia: COMPRA_ID,
    titulo: 'Bolo sem lactose',
    valor: 29.9,
    taxaPlataforma: 4.49,
    expiraEm: new Date('2026-11-01T12:00:00Z'),
  };
}

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function pagamentoMp(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: 123456789,
    status: 'approved',
    transaction_amount: 29.9,
    external_reference: COMPRA_ID,
    payment_method_id: 'pix',
    date_approved: '2026-10-31T15:00:00.000-03:00',
    ...sobrescrever,
  };
}

describe('MercadoPagoService', () => {
  let env: Record<string, string | undefined>;
  let fetchMock: jest.SpyInstance;
  let avisos: jest.SpyInstance;
  let service: MercadoPagoService;

  beforeEach(() => {
    env = { ...ENV_PADRAO };
    fetchMock = jest.spyOn(global, 'fetch');
    avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new MercadoPagoService({
      get: (chave: string) => env[chave],
    } as unknown as ConfigService);
  });

  afterEach(() => jest.restoreAllMocks());

  /** URL, opções e body (já parseado) da chamada `n` ao fetch. */
  function chamada(n = 0) {
    const [url, opcoes] = fetchMock.mock.calls[n] as [string, RequestInit];
    const headers = opcoes.headers as Record<string, string>;
    const body = opcoes.body ? JSON.parse(opcoes.body as string) : undefined;
    return { url, opcoes, headers, body };
  }

  describe('criarPreferencia', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        respostaJson(201, {
          id: 'pref-1',
          init_point:
            'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1',
        }),
      );
    });

    it('devolve o ID da preferência e o link de pagamento', async () => {
      await expect(
        service.criarPreferencia(TOKEN, dadosPreferencia()),
      ).resolves.toEqual({
        id: 'pref-1',
        checkoutUrl:
          'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1',
      });
    });

    it('chama o endpoint de preferências com o token do vendedor', async () => {
      await service.criarPreferencia(TOKEN, dadosPreferencia());

      const { url, opcoes, headers } = chamada();
      expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
      expect(opcoes.method).toBe('POST');
      expect(headers).toMatchObject({
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      });
    });

    it('usa o ID da compra como chave de idempotência', async () => {
      await service.criarPreferencia(TOKEN, dadosPreferencia());

      expect(chamada().headers['x-idempotency-key']).toBe(COMPRA_ID);
    });

    it('traduz os dados para o formato do Mercado Pago', async () => {
      await service.criarPreferencia(TOKEN, dadosPreferencia());

      expect(chamada().body).toEqual({
        items: [
          {
            id: COMPRA_ID,
            title: 'Bolo sem lactose',
            quantity: 1,
            unit_price: 29.9,
            currency_id: 'BRL',
          },
        ],
        marketplace_fee: 4.49,
        external_reference: COMPRA_ID,
        notification_url: 'https://api.exemplo.com/api/mercado-pago/webhook',
        back_urls: {
          success: 'https://app.exemplo.com/compra/compra-1',
          failure: 'https://app.exemplo.com/compra/compra-1',
          pending: 'https://app.exemplo.com/compra/compra-1',
        },
        auto_return: 'approved',
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
        expires: true,
        expiration_date_to: '2026-11-01T12:00:00.000Z',
      });
    });

    it.each(['API_URL_PUBLICA', 'FRONT_URL'])(
      'responde 503 sem %s, sem chamar o Mercado Pago',
      async (variavel) => {
        env[variavel] = undefined;

        await expect(
          service.criarPreferencia(TOKEN, dadosPreferencia()),
        ).rejects.toThrow(ServiceUnavailableException);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('buscarPagamento', () => {
    it('consulta o pagamento com o token do vendedor, sem body', async () => {
      fetchMock.mockResolvedValue(respostaJson(200, pagamentoMp()));

      await service.buscarPagamento(TOKEN, '123456789');

      const { url, opcoes, headers, body } = chamada();
      expect(url).toBe('https://api.mercadopago.com/v1/payments/123456789');
      expect(opcoes.method).toBe('GET');
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers['content-type']).toBeUndefined();
      expect(headers['x-idempotency-key']).toBeUndefined();
      expect(body).toBeUndefined();
    });

    it('traduz o pagamento para o formato da API', async () => {
      fetchMock.mockResolvedValue(respostaJson(200, pagamentoMp()));

      await expect(
        service.buscarPagamento(TOKEN, '123456789'),
      ).resolves.toEqual({
        id: '123456789',
        status: 'aprovado',
        valor: 29.9,
        referencia: COMPRA_ID,
        metodo: 'pix',
        pagoEm: new Date('2026-10-31T18:00:00.000Z'),
      });
    });

    it('devolve pagoEm nulo enquanto o pagamento não foi aprovado', async () => {
      fetchMock.mockResolvedValue(
        respostaJson(
          200,
          pagamentoMp({ status: 'pending', date_approved: null }),
        ),
      );

      const pagamento = await service.buscarPagamento(TOKEN, '123456789');
      expect(pagamento.pagoEm).toBeNull();
    });

    it('não deixa o ID do webhook alterar o caminho da URL', async () => {
      fetchMock.mockResolvedValue(respostaJson(200, pagamentoMp()));

      await service.buscarPagamento(TOKEN, '../../users/me');

      expect(chamada().url).toBe(
        'https://api.mercadopago.com/v1/payments/..%2F..%2Fusers%2Fme',
      );
    });

    it.each([
      ['approved', 'aprovado'],
      ['rejected', 'recusado'],
      ['cancelled', 'recusado'],
      ['refunded', 'estornado'],
      ['charged_back', 'estornado'],
      ['pending', 'pendente'],
      ['in_process', 'pendente'],
      ['authorized', 'pendente'],
      ['in_mediation', 'pendente'],
      ['status_novo_do_mp', 'pendente'],
    ])('traduz o status %s para %s', async (statusMp, esperado) => {
      fetchMock.mockResolvedValue(
        respostaJson(200, pagamentoMp({ status: statusMp })),
      );

      const pagamento = await service.buscarPagamento(TOKEN, '123456789');
      expect(pagamento.status).toBe(esperado);
    });
  });

  describe('erros', () => {
    it('responde 502 quando o Mercado Pago recusa', async () => {
      fetchMock.mockResolvedValue(
        respostaJson(400, { message: 'invalid marketplace_fee' }),
      );

      await expect(
        service.criarPreferencia(TOKEN, dadosPreferencia()),
      ).rejects.toThrow(BadGatewayException);
    });

    it('responde 502 mesmo quando o erro não vem em JSON', async () => {
      fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

      await expect(service.buscarPagamento(TOKEN, '1')).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('responde 503 quando o Mercado Pago não responde', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.buscarPagamento(TOKEN, '1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('registra o motivo da recusa sem o token', async () => {
      fetchMock.mockResolvedValue(
        respostaJson(401, { message: 'invalid access token' }),
      );

      await expect(service.buscarPagamento(TOKEN, '1')).rejects.toThrow();

      const mensagens = avisos.mock.calls.map(([m]) => String(m)).join('\n');
      expect(mensagens).toContain('401');
      expect(mensagens).toContain('invalid access token');
      expect(mensagens).not.toContain(TOKEN);
    });

    it('não expõe o token na mensagem do erro', async () => {
      fetchMock.mockResolvedValue(respostaJson(400, { message: 'erro' }));

      const erro = await service
        .criarPreferencia(TOKEN, dadosPreferencia())
        .catch((e: Error) => e);

      expect(
        JSON.stringify((erro as BadGatewayException).getResponse()),
      ).not.toContain(TOKEN);
    });
  });
});
