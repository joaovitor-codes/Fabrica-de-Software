import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { IngredientesReceitaService } from './ingredientes-receita.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { IaModule } from '../../ia/ia.module';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';

@Module({
  imports: [IaModule, VisibilidadeModule],
  controllers: [ReceitaController],
  providers: [ReceitaService, UsuarioService, IngredientesReceitaService],
  exports: [IngredientesReceitaService],
})
export class ReceitaModule {}
