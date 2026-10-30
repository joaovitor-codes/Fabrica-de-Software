import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecebedorService } from './recebedor.service';

/** Renova diariamente os tokens OAuth dos vendedores antes de vencerem. */
@Injectable()
export class RecebedorRenovacaoJob {
  private readonly logger = new Logger(RecebedorRenovacaoJob.name);

  constructor(private readonly recebedorService: RecebedorService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async executar() {
    const { renovadas, desconectadas } =
      await this.recebedorService.renovarProximasDoVencimento();
    if (renovadas || desconectadas) {
      this.logger.log(
        `Contas recebedoras: ${renovadas} renovadas, ${desconectadas} desconectadas.`,
      );
    }
  }
}
