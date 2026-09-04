import { Module } from '@nestjs/common';
import { RestricaoAlimentarService } from './restricao-alimentar.service';
import { RestricaoAlimentarController } from './restricao-alimentar.controller';

@Module({
  providers: [RestricaoAlimentarService],
  controllers: [RestricaoAlimentarController],
  exports: [RestricaoAlimentarService],
})
export class RestricaoAlimentarModule {}
