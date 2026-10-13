import { Module } from '@nestjs/common';
import { NotificacaoService } from './notificacao.service';

@Module({
  providers: [NotificacaoService],
  controllers: [],
  exports: [NotificacaoService],
})
export class NotificacaoModule {}
