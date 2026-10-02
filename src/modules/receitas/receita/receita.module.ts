import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { AdaptacaoReceitaController } from './adaptacao-receita.controller';
import { AdaptacaoReceitaService } from './adaptacao-receita.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { PontosTransacaoModule } from '../pontos-transacao/pontos-transacao.module';
import { IaModule } from '../../ia/ia.module';

@Module({
  imports: [PontosTransacaoModule, IaModule],
  controllers: [ReceitaController, AdaptacaoReceitaController],
  providers: [ReceitaService, UsuarioService, AdaptacaoReceitaService],
})
export class ReceitaModule {}
