import { Module } from '@nestjs/common';
import { UnidadeMedidaService } from './unidade-medida.service';
import { UnidadeMedidaController } from './unidade-medida.controller';

@Module({
  controllers: [UnidadeMedidaController],
  providers: [UnidadeMedidaService],
})
export class UnidadeMedidaModule {}
