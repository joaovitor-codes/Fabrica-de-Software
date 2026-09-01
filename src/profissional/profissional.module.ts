import { Module } from '@nestjs/common';
import { ProfissionalService } from './profissional.service';
import { ProfissionalController } from './profissional.controller';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioService } from '../usuario/usuario.service';
import { PacientesService } from '../pacientes/pacientes.service';

@Module({
  providers: [ProfissionalService, PrismaService, PacientesService, UsuarioService],
  controllers: [ProfissionalController]
})
export class ProfissionalModule {}
