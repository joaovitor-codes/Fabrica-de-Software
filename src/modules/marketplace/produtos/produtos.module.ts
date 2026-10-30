import { Module } from '@nestjs/common';
import { ProdutoDenunciaModule } from './produto-denuncia/produto-denuncia.module';
import { ProdutoMidiaModule } from './produto-midia/produto-midia.module';
import { ProdutoModule } from './produto/produto.module';

/**
 * Junta os módulos da vitrine. A ORDEM IMPORTA: todos usam o prefixo
 * `api/produto`, e o Nest registra as rotas na ordem dos módulos. A rota fixa
 * `GET denuncias` precisa vir antes de `GET :id` (ProdutoModule), senão
 * "denuncias" cai no :id e responde 400. Os submódulos importam o
 * ProdutoModule para usar o ProdutoService; como o Nest registra quem importa
 * antes do importado, ele continua depois deles. Coberto por
 * produtos.module.spec.ts.
 */
@Module({
  imports: [ProdutoDenunciaModule, ProdutoMidiaModule, ProdutoModule],
})
export class ProdutosModule {}
