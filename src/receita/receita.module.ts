import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [ReceitaController],
  providers: [ReceitaService, AuthGuard, RolesGuard],
})
export class ReceitaModule {}
