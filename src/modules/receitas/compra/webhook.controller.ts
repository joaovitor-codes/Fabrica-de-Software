import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { assinaturaValida } from '../../marketplace/mercado-pago/assinatura-webhook';
import { WebhookCompraService } from './webhook-compra.service';

/** Corpo do aviso no formato Webhooks. Sem DTO: o Mercado Pago manda campos a mais. */
interface AvisoMercadoPago {
  type?: string;
  /** Conta do Mercado Pago do vendedor (o user_id do OAuth). */
  user_id?: number | string;
  data?: { id?: string };
}

/**
 * Fica no módulo da compra, e não no do Mercado Pago, para o MercadoPagoModule
 * continuar sem conhecer receita e compra (o CompraModule já depende dele).
 */
@Controller('api/mercado-pago')
export class WebhookController {
  constructor(
    private readonly webhookCompra: WebhookCompraService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Recebe os avisos de pagamento do Mercado Pago' })
  @ApiOkResponse({ description: 'Aviso recebido (processado ou ignorado).' })
  @ApiUnauthorizedResponse({ description: 'Assinatura inválida.' })
  @SkipThrottle({ leitura: true, escrita: true })
  @HttpCode(HttpStatus.OK)
  @Post('webhook')
  async receber(
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query('data.id') dataId: string | undefined,
    @Body() aviso: AvisoMercadoPago,
  ): Promise<void> {
    const valida = assinaturaValida({
      xSignature,
      xRequestId,
      dataId,
      segredo: this.configService.get<string>('MP_WEBHOOK_SECRET'),
    });
    if (!valida) {
      throw new UnauthorizedException('Assinatura inválida.');
    }

    if (aviso?.type !== 'payment' || aviso.user_id == null) return;

    await this.webhookCompra.processar(String(aviso.user_id), dataId!);
  }
}
