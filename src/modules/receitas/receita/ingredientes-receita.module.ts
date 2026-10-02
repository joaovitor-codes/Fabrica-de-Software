import { Module } from '@nestjs/common';
import { IngredientesReceitaService } from './ingredientes-receita.service';
import { IaModule } from '../../ia/ia.module';

/**
 * Validação da lista de ingredientes e checagem do modo de preparo. Módulo
 * próprio porque a receita e a adaptação usam, e a receita também usa a
 * adaptação: assim os dois não dependem um do outro em ciclo.
 */
@Module({
  imports: [IaModule],
  providers: [IngredientesReceitaService],
  exports: [IngredientesReceitaService],
})
export class IngredientesReceitaModule {}
