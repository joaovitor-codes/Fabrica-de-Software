import { Module } from '@nestjs/common';
import { ProdutoController } from './produto.controller';
import { ProdutoMidiaController } from './produto-midia.controller';
import { ProdutoService } from './produto.service';

@Module({
  controllers: [ProdutoController, ProdutoMidiaController],
  providers: [ProdutoService],
  exports: [ProdutoService],
})
export class ProdutoModule {}
