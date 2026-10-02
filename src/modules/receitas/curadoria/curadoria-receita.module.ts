import { Module } from '@nestjs/common';
import { CuradoriaReceitaController } from './curadoria-receita.controller';
import { CuradoriaReceitaService } from './curadoria-receita.service';
import { PontosTransacaoModule } from '../pontos-transacao/pontos-transacao.module';

@Module({
  imports: [PontosTransacaoModule],
  controllers: [CuradoriaReceitaController],
  providers: [CuradoriaReceitaService],
})
export class CuradoriaReceitaModule {}
