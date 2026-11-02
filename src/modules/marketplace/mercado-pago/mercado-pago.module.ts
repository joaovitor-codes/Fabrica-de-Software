import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercado-pago.service';

// A rota do webhook fica no CompraModule (WebhookController): este módulo
// só traduz a API do Mercado Pago e não conhece receita nem compra.
@Module({
  providers: [MercadoPagoService],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
