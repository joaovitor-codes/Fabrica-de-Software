import { Module } from '@nestjs/common';
import { TermosController } from './termos.controller';
import { TermosService } from './termos.service';

@Module({
  controllers: [TermosController],
  providers: [TermosService],
  exports: [TermosService],
})
export class TermosModule {}
