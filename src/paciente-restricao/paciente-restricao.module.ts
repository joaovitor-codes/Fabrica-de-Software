import { Module } from '@nestjs/common';
import { PacienteRestricaoService } from './paciente-restricao.service';
import { PacienteRestricaoController } from './paciente-restricao.controller';
import { RestricaoAlimentarModule } from '../restricao-alimentar/restricao-alimentar.module';
import { PacientesModule } from '../pacientes/pacientes.module';

@Module({
  imports: [RestricaoAlimentarModule, PacientesModule],
  providers: [PacienteRestricaoService],
  controllers: [PacienteRestricaoController],
  exports: [PacienteRestricaoService]
})
export class PacienteRestricaoModule {}
