import { Module } from '@nestjs/common';
import { IngredienteService } from './ingrediente.service';
import { IngredienteController } from './ingrediente.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [IngredienteController],
  providers: [IngredienteService, PrismaService],
})
export class IngredienteModule {}
