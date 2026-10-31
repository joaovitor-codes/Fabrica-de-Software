import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { IngredientesReceitaModule } from './ingredientes-receita.module';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';
import { AdaptacaoModule } from '../adaptacao/adaptacao.module';
import { TermosModule } from '../../marketplace/termos/termos.module';

@Module({
  imports: [
    IngredientesReceitaModule,
    VisibilidadeModule,
    AdaptacaoModule,
    TermosModule,
  ],
  controllers: [ReceitaController],
  providers: [ReceitaService, UsuarioService],
})
export class ReceitaModule {}
