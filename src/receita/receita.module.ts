import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { IaService } from '../ia/ia.service';

@Module({
  controllers: [ReceitaController],
  providers: [ReceitaService, IaService],
})
export class ReceitaModule {}
