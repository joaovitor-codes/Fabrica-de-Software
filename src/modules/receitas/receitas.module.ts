import { Module } from '@nestjs/common';
import { FavoritoModule } from './favorito/favorito.module';
import { CuradoriaReceitaModule } from './curadoria/curadoria-receita.module';
import { AdaptacaoModule } from './adaptacao/adaptacao.module';
import { ReceitaModule } from './receita/receita.module';

/**
 * Junta os módulos de receita. A ORDEM IMPORTA: todos usam o prefixo
 * `api/receita`, e o Nest registra as rotas na ordem dos módulos. As rotas
 * fixas `GET favoritos` e `GET pendentes` precisam vir antes de
 * `GET :id` (ReceitaModule), senão "favoritos" cai no :id e responde 400.
 * Por isso ReceitaModule vem por último e só este módulo (e o de adaptação,
 * que vem antes dele aqui) o importa. Coberto por receitas.module.spec.ts.
 */
@Module({
  imports: [
    FavoritoModule,
    CuradoriaReceitaModule,
    AdaptacaoModule,
    ReceitaModule,
  ],
})
export class ReceitasModule {}
