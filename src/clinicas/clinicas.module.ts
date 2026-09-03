import { Module } from '@nestjs/common';
import { ClinicasService } from './clinicas.service';
import { ClinicasController } from './clinicas.controller';
import { EnderecoModule } from '../endereco/endereco.module';

@Module({
  imports: [EnderecoModule],
  providers: [ClinicasService],
  controllers: [ClinicasController],
  exports: [ClinicasService],
})
export class ClinicasModule {}
