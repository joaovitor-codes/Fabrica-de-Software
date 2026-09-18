import { Module } from '@nestjs/common';
import { IngredienteRestricaoController } from './ingrediente-restricao.controller';
import { IngredienteRestricaoService } from './ingrediente-restricao.service';
import { RegraNutricionalService } from './regra-nutricional.service';
import { IaModule } from '../ia/ia.module';
import { IngredienteSubstitutoService } from './ingrediente-substituto.service';

@Module({
  imports: [IaModule],
  controllers: [IngredienteRestricaoController],
  providers: [IngredienteRestricaoService, RegraNutricionalService, IngredienteSubstitutoService],
  exports: [IngredienteRestricaoService, RegraNutricionalService, IngredienteSubstitutoService],
})
export class IngredienteRestricaoModule {}
