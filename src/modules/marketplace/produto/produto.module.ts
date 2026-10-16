import { Module } from '@nestjs/common';
import { ProdutoController } from './produto.controller';
import { ProdutoMidiaController } from './produto-midia.controller';
import { ProdutoPublicoController } from './produto-publico.controller';
import { ProdutoService } from './produto.service';

@Module({
  controllers: [
    ProdutoController,
    ProdutoMidiaController,
    ProdutoPublicoController,
  ],
  providers: [ProdutoService],
  exports: [ProdutoService],
})
export class ProdutoModule {}
