import { Module } from '@nestjs/common';
import { IngredienteRestricaoController } from './ingrediente-restricao.controller';
import { IngredienteRestricaoService } from './ingrediente-restricao.service';
import { IngredienteService } from '../ingrediente/ingrediente.service';
import { RestricaoAlimentarModule } from '../restricao-alimentar/restricao-alimentar.module';
import { IngredienteModule } from '../ingrediente/ingrediente.module';

@Module({
  imports: [RestricaoAlimentarModule, IngredienteModule],
  controllers: [IngredienteRestricaoController],
  providers: [IngredienteRestricaoService],
  exports: [IngredienteService]
})
export class IngredienteRestricaoModule {}
