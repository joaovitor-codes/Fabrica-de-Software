import { Module } from '@nestjs/common';
import { AdaptacaoController } from './adaptacao.controller';
import { AdaptacaoBaseService } from './adaptacao-base.service';
import { AdaptacaoPacienteService } from './adaptacao-paciente.service';
import { AdaptacaoProfissionalService } from './adaptacao-profissional.service';
import { IaModule } from '../../ia/ia.module';
import { ReceitaModule } from '../receita/receita.module';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';

@Module({
  imports: [IaModule, ReceitaModule, VisibilidadeModule],
  controllers: [AdaptacaoController],
  providers: [
    AdaptacaoBaseService,
    AdaptacaoPacienteService,
    AdaptacaoProfissionalService,
  ],
})
export class AdaptacaoModule {}
