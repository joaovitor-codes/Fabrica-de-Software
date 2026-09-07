import { Module } from '@nestjs/common';
import { RestricaoAlimentarService } from './restricao-alimentar.service';
import { RestricaoRegraNutricionalService } from './restricao-regra-nutricional-service';
import { RestricaoAlimentarController } from './restricao-alimentar.controller';
import { IngredienteRestricaoModule } from '../ingrediente-restricao/ingrediente-restricao.module';

@Module({
  imports: [IngredienteRestricaoModule],
  providers: [RestricaoAlimentarService, RestricaoRegraNutricionalService],
  controllers: [RestricaoAlimentarController],
  exports: [RestricaoAlimentarService, RestricaoRegraNutricionalService],
})
export class RestricaoAlimentarModule {}
