import { Module } from '@nestjs/common';
import { ClinicasService } from './clinicas.service';
import { ClinicasController } from './clinicas.controller';

@Module({
  providers: [ClinicasService],
  controllers: [ClinicasController]
})
export class ClinicasModule {}
