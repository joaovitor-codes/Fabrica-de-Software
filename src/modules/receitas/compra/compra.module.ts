import { Module } from '@nestjs/common';
import { MercadoPagoModule } from '../../marketplace/mercado-pago/mercado-pago.module';
import { RecebedorModule } from '../../marketplace/recebedor/recebedor.module';
import { TermosModule } from '../../marketplace/termos/termos.module';
import { NotificacaoModule } from '../../notificacao/notificacao.module';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';
import { CompraVencimentoJob } from './compra-vencimento.job';
import { CompraController } from './compra.controller';
import { CompraService } from './compra.service';
import { ReembolsoService } from './reembolso.service';
import { WebhookCompraService } from './webhook-compra.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [
    TermosModule,
    RecebedorModule,
    MercadoPagoModule,
    VisibilidadeModule,
    NotificacaoModule,
  ],
  controllers: [CompraController, WebhookController],
  providers: [
    CompraService,
    ReembolsoService,
    WebhookCompraService,
    CompraVencimentoJob,
  ],
})
export class CompraModule {}
