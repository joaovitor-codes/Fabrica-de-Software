import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { PontosTransacaoModule } from '../pontos-transacao/pontos-transacao.module';
import { IaModule } from '../../ia/ia.module';

@Module({
  imports: [PontosTransacaoModule, IaModule],
  controllers: [ReceitaController],
  providers: [ReceitaService, UsuarioService],
})
export class ReceitaModule {}
