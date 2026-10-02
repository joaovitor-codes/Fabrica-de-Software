import { Module } from '@nestjs/common';
import { PontosTransacaoService } from './pontos-transacao.service';
import { PontosTransacaoController } from './pontos-transacao.controller';

@Module({
  controllers: [PontosTransacaoController],
  providers: [PontosTransacaoService],
  exports: [PontosTransacaoService]
})
export class PontosTransacaoModule {}
