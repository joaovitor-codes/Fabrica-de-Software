import { Module } from '@nestjs/common';
import { ProdutoModule } from '../produto/produto.module';
import { ProdutoDenunciaController } from './produto-denuncia.controller';
import { ProdutoDenunciaService } from './produto-denuncia.service';

@Module({
  imports: [ProdutoModule],
  controllers: [ProdutoDenunciaController],
  providers: [ProdutoDenunciaService],
})
export class ProdutoDenunciaModule {}
