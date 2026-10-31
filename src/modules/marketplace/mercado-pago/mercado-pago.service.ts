import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DadosPreferencia,
  PagamentoMercadoPago,
  StatusPagamentoMercadoPago,
} from './mercado-pago.types';

const API = 'https://api.mercadopago.com';

/**
 * Tradutor entre a API e o Mercado Pago. Não conhece receita nem compra:
 * recebe o token do vendedor e dados em português, devolve dados em português.
 * O token nunca vai para log nem para resposta.
 */
@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  constructor(private readonly configService: ConfigService) {}

  /** Cria a preferência do Checkout Pro e devolve o link de pagamento. */
  async criarPreferencia(token: string, dados: DadosPreferencia) {
    const { apiUrl, frontUrl } = this.urls();
    const retorno = `${frontUrl}/compra/${dados.referencia}`;

    const corpo = {
      items: [
        {
          id: dados.referencia,
          title: dados.titulo,
          quantity: 1,
          unit_price: dados.valor,
          currency_id: 'BRL',
        },
      ],
      marketplace_fee: dados.taxaPlataforma,
      external_reference: dados.referencia,
      notification_url: `${apiUrl}/api/mercado-pago/webhook`,
      back_urls: { success: retorno, failure: retorno, pending: retorno },
      auto_return: 'approved',
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
      expires: true,
      expiration_date_to: dados.expiraEm.toISOString(),
    };

    const resposta = await this.requisitar<{ id: string; init_point: string }>(
      token,
      'POST',
      '/checkout/preferences',
      corpo,
      dados.referencia,
    );

    return { id: resposta.id, checkoutUrl: resposta.init_point };
  }

  /** Consulta um pagamento; usado pelo webhook, que só recebe o ID. */
  async buscarPagamento(
    token: string,
    pagamentoId: string,
  ): Promise<PagamentoMercadoPago> {
    const p = await this.requisitar<{
      id: number | string;
      status: string;
      transaction_amount: number;
      external_reference: string;
      payment_method_id: string;
      date_approved: string | null;
    }>(token, 'GET', `/v1/payments/${encodeURIComponent(pagamentoId)}`);

    return {
      id: String(p.id),
      status: this.traduzirStatus(p.status),
      valor: p.transaction_amount,
      referencia: p.external_reference,
      metodo: p.payment_method_id,
      pagoEm: p.date_approved ? new Date(p.date_approved) : null,
    };
  }

  private async requisitar<T>(
    token: string,
    metodo: 'GET' | 'POST',
    endpoint: string,
    corpo?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    };
    if (corpo) headers['content-type'] = 'application/json';
    // Um retry com a mesma chave não cria uma segunda preferência.
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;

    let resposta: Response;
    try {
      resposta = await fetch(`${API}${endpoint}`, {
        method: metodo,
        headers,
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      this.logger.warn(`Mercado Pago inacessível: ${metodo} ${endpoint}`);
      throw new ServiceUnavailableException(
        'Não foi possível falar com o Mercado Pago. Tente novamente.',
      );
    }

    if (!resposta.ok) {
      const erro = (await resposta.json().catch(() => ({}))) as {
        message?: string;
      };
      this.logger.warn(
        `Mercado Pago recusou ${metodo} ${endpoint}: ${resposta.status} ${erro.message ?? ''}`,
      );
      throw new BadGatewayException('O Mercado Pago recusou a operação.');
    }

    return (await resposta.json()) as T;
  }

  /** Status desconhecido conta como pendente: lançar faria o webhook falhar para sempre. */
  private traduzirStatus(status: string): StatusPagamentoMercadoPago {
    switch (status) {
      case 'approved':
        return 'aprovado';
      case 'rejected':
      case 'cancelled':
        return 'recusado';
      case 'refunded':
      case 'charged_back':
        return 'estornado';
      default:
        return 'pendente';
    }
  }

  private urls() {
    const apiUrl = this.configService.get<string>('API_URL_PUBLICA');
    const frontUrl = this.configService.get<string>('FRONT_URL');

    if (!apiUrl || !frontUrl) {
      throw new ServiceUnavailableException(
        'Integração com o Mercado Pago não configurada.',
      );
    }
    return { apiUrl, frontUrl };
  }
}
