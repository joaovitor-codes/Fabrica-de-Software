import { Module } from '@nestjs/common';
import { UnidadeMedidaService } from './unidade-medida.service';
import { UnidadeMedidaController } from './unidade-medida.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [UnidadeMedidaController],
  providers: [UnidadeMedidaService, PrismaService],
})
export class UnidadeMedidaModule {}
