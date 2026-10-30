import { Module } from '@nestjs/common';
import { MercadoPagoOAuthClient } from './mercado-pago-oauth.client';
import { RecebedorController } from './recebedor.controller';
import { RecebedorRenovacaoJob } from './recebedor-renovacao.job';
import { RecebedorService } from './recebedor.service';
import { TokenCriptoService } from './token-cripto.service';

@Module({
  controllers: [RecebedorController],
  providers: [
    RecebedorService,
    MercadoPagoOAuthClient,
    TokenCriptoService,
    RecebedorRenovacaoJob,
  ],
  // TokenCriptoService: a compra (M4) decifra o token do vendedor para criar a preferência.
  exports: [RecebedorService, TokenCriptoService],
})
export class RecebedorModule {}
