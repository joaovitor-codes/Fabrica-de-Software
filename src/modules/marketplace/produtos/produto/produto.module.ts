import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../../../notificacao/notificacao.module';
import { TermosModule } from '../../termos/termos.module';
import { ProdutoController } from './produto.controller';
import { ProdutoPublicoController } from './produto-publico.controller';
import { ProdutoService } from './produto.service';

@Module({
  imports: [NotificacaoModule, TermosModule],
  controllers: [
    // Antes do público: GET meus e opcoes/* precisam vir antes de GET :id.
    ProdutoController,
    ProdutoPublicoController,
  ],
  providers: [ProdutoService],
  exports: [ProdutoService],
})
export class ProdutoModule {}
