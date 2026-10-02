import { Module } from '@nestjs/common';
import { IaService } from './ia.service';

@Module({
  providers: [IaService],
  exports: [IaService],
})
export class IaModule {}
