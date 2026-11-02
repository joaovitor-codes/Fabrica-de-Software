import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CompraService } from './compra.service';

/**
 * De hora em hora, cancela as compras pendentes com a preferência vencida.
 * Assim o comprador que desistiu não fica preso à compra viva antiga.
 */
@Injectable()
export class CompraVencimentoJob {
  private readonly logger = new Logger(CompraVencimentoJob.name);

  constructor(private readonly compraService: CompraService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async executar() {
    const canceladas = await this.compraService.cancelarVencidas();
    if (canceladas) {
      this.logger.log(`Compras pendentes vencidas: ${canceladas} canceladas.`);
    }
  }
}
