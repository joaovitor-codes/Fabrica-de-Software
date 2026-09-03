import { Module } from '@nestjs/common';
import { PacientesController } from './pacientes.controller';
import { PacientesService } from './pacientes.service';

@Module({
  controllers: [PacientesController],
  providers: [PacientesService]
})
export class PacientesModule {}
