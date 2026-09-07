import { Module } from '@nestjs/common';
import { IngredienteRestricaoController } from './ingrediente-restricao.controller';
import { IngredienteRestricaoService } from './ingrediente-restricao.service';
import { RegraNutricionalService } from './regra-nutricional.service';

@Module({
  controllers: [IngredienteRestricaoController],
  providers: [IngredienteRestricaoService, RegraNutricionalService],
  exports: [IngredienteRestricaoService, RegraNutricionalService],
})
export class IngredienteRestricaoModule {}
