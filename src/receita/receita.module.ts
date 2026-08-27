import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [ReceitaController],
  providers: [ReceitaService, PrismaService],
})
export class ReceitaModule {}
