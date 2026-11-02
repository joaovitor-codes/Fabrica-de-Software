/// <reference types="jest" />

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { WebhookCompraService } from '../webhook-compra.service';
import { WebhookController } from '../webhook.controller';

const SEGREDO = 'segredo-do-painel';
const DATA_ID = '123456789';
const REQUEST_ID = 'req-1';
const TS = '1762099200';
const ASSINATURA = `ts=${TS},v1=${createHmac('sha256', SEGREDO)
  .update(`id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`)
  .digest('hex')}`;

describe('WebhookController', () => {
  let controller: WebhookController;
  let webhookCompra: { processar: jest.Mock };
  let segredo: string | undefined;

  beforeEach(async () => {
    segredo = SEGREDO;
    webhookCompra = { processar: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: WebhookCompraService, useValue: webhookCompra },
        { provide: ConfigService, useValue: { get: () => segredo } },
      ],
    }).compile();

    controller = moduleRef.get(WebhookController);
  });

  const receber = (aviso: object, assinatura = ASSINATURA) =>
    controller.receber(assinatura, REQUEST_ID, DATA_ID, aviso);

  it('processa o aviso de pagamento assinado, com a conta do vendedor', async () => {
    await receber({ type: 'payment', user_id: 123456, data: { id: DATA_ID } });

    expect(webhookCompra.processar).toHaveBeenCalledWith('123456', DATA_ID);
  });

  it('recusa assinatura inválida sem processar', async () => {
    await expect(
      receber({ type: 'payment', user_id: 1 }, `ts=${TS},v1=${'0'.repeat(64)}`),
    ).rejects.toThrow(UnauthorizedException);
    expect(webhookCompra.processar).not.toHaveBeenCalled();
  });

  it('recusa tudo quando MP_WEBHOOK_SECRET não está configurado', async () => {
    segredo = undefined;

    await expect(receber({ type: 'payment', user_id: 1 })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('fica fora dos dois limites de requisições (leitura e escrita)', () => {
    const metodo = Object.getOwnPropertyDescriptor(
      WebhookController.prototype,
      'receber',
    )!.value as object;
    for (const limite of ['leitura', 'escrita']) {
      expect(
        Reflect.getMetadata(`THROTTLER:SKIP${limite}`, metodo) as boolean,
      ).toBe(true);
    }
  });

  it.each([
    ['outro tipo de aviso', { type: 'merchant_order', user_id: 1 }],
    ['aviso sem user_id', { type: 'payment' }],
  ])('ignora %s', async (_caso, aviso) => {
    await expect(receber(aviso)).resolves.toBeUndefined();
    expect(webhookCompra.processar).not.toHaveBeenCalled();
  });
});
