import { Module } from '@nestjs/common';
import { IngredienteRestricaoController } from './ingrediente-restricao.controller';
import { IngredienteRestricaoService } from './ingrediente-restricao.service';

@Module({
  controllers: [IngredienteRestricaoController],
  providers: [IngredienteRestricaoService],
  exports: [IngredienteRestricaoService],
})
export class IngredienteRestricaoModule {}
