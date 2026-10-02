import { Module } from '@nestjs/common';
import { VisibilidadeReceitaService } from './visibilidade-receita.service';

@Module({
  providers: [VisibilidadeReceitaService],
  exports: [VisibilidadeReceitaService],
})
export class VisibilidadeModule {}
