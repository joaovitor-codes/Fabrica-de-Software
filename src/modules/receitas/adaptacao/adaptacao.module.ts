import { Module } from '@nestjs/common';
import { AdaptacaoController } from './adaptacao.controller';
import { AdaptacaoBaseService } from './adaptacao-base.service';
import { AdaptacaoPacienteService } from './adaptacao-paciente.service';
import { AdaptacaoProfissionalService } from './adaptacao-profissional.service';
import { AdaptacaoCatalogoService } from './adaptacao-catalogo.service';
import { IaModule } from '../../ia/ia.module';
import { IngredientesReceitaModule } from '../receita/ingredientes-receita.module';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';

@Module({
  imports: [IaModule, IngredientesReceitaModule, VisibilidadeModule],
  controllers: [AdaptacaoController],
  providers: [
    AdaptacaoBaseService,
    AdaptacaoPacienteService,
    AdaptacaoProfissionalService,
    AdaptacaoCatalogoService,
  ],
  exports: [AdaptacaoCatalogoService],
})
export class AdaptacaoModule {}
