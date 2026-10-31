import { Module } from '@nestjs/common';
import { MercadoPagoModule } from '../../marketplace/mercado-pago/mercado-pago.module';
import { RecebedorModule } from '../../marketplace/recebedor/recebedor.module';
import { TermosModule } from '../../marketplace/termos/termos.module';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';
import { CompraController } from './compra.controller';
import { CompraService } from './compra.service';

@Module({
  imports: [
    TermosModule,
    RecebedorModule,
    MercadoPagoModule,
    VisibilidadeModule,
  ],
  controllers: [CompraController],
  providers: [CompraService],
})
export class CompraModule {}
