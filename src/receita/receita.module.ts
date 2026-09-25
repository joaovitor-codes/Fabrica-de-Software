import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { UsuarioService } from '../usuario/usuario.service';
import { PontosTransacaoModule } from '../pontos-transacao/pontos-transacao.module';

@Module({
  imports: [PontosTransacaoModule],
  controllers: [ReceitaController],
  providers: [ReceitaService, UsuarioService],
})
export class ReceitaModule {}
