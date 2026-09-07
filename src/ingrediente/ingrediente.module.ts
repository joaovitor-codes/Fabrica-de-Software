import { Module } from '@nestjs/common';
import { IngredienteService } from './ingrediente.service';
import { IngredienteController } from './ingrediente.controller';
import { IngredienteRestricaoModule } from '../ingrediente-restricao/ingrediente-restricao.module';

@Module({
  imports: [IngredienteRestricaoModule],
  controllers: [IngredienteController],
  providers: [IngredienteService],
  exports: [IngredienteService]
})
export class IngredienteModule {}
