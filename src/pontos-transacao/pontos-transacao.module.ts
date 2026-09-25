import { Module } from '@nestjs/common';
import { PontosTransacaoService } from './pontos-transacao.service';

@Module({
  providers: [PontosTransacaoService],
  exports: [PontosTransacaoService]
})
export class PontosTransacaoModule {}
