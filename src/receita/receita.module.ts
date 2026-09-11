import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { IaService } from '../ia/ia.service';
import { AuthGuard } from '../auth/auth.guard';
import { UsuarioService } from '../usuario/usuario.service';

@Module({
  controllers: [ReceitaController],
  providers: [ReceitaService, IaService, AuthGuard, UsuarioService],
})
export class ReceitaModule {}
