import { Module } from '@nestjs/common';
import { TermosController } from './termos/termos.controller';
import { TermosService } from './termos/termos.service';

@Module({
  controllers: [TermosController],
  providers: [TermosService],
  exports: [TermosService],
})
export class MarketplaceModule {}
