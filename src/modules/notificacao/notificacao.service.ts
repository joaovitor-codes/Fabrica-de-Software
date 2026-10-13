import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CriarNotificacaoInput } from './dtos/notificacao.types';
import { Notificacao, Prisma } from '@prisma/client';

@Injectable()
export class NotificacaoService {
  constructor(private readonly prismaService: PrismaService) {}

  async criar(
    input: CriarNotificacaoInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Notificacao | null> {
    // Usa a transação de quem chamou, se houver; senão, o Prisma normal
    const banco = tx ?? this.prismaService;

    // A CHECK chk_notificacao_exclusive_arc exige exatamente 1 referência
    const ref = input.referencia;
    let quantidade = 0;
    if (ref.receitaId) quantidade++;
    if (ref.assinaturaId) quantidade++;
    if (ref.planoAlimentarItemId) quantidade++;
    if (ref.indicacaoId) quantidade++;
    if (ref.anamneseId) quantidade++;
    if (ref.produtoId) quantidade++;

    if (quantidade !== 1) {
      throw new InternalServerErrorException(
        `A notificação precisa de 1 referência, mas recebeu ${quantidade}`,
      );
    }

    const tipo = await banco.tipoNotificacao.findUnique({
      where: { codigo: input.codigo },
    });

    if (!tipo) {
      throw new InternalServerErrorException(
        `Tipo de notificação '${input.codigo}' não cadastrado. A migration tipos_notificacao_marketplace foi aplicada?`,
      );
    }

    // Tipo desligado no banco: não notifica, mas não quebra o fluxo de quem chamou
    if (!tipo.ativo) {
      return null;
    }

    return banco.notificacao.create({
      data: {
        usuarioId: input.usuarioId,
        tipoNotificacaoId: tipo.id,
        titulo: input.titulo,
        mensagem: input.mensagem ?? null,
        receitaId: ref.receitaId || null,
        assinaturaId: ref.assinaturaId || null,
        planoAlimentarItemId: ref.planoAlimentarItemId || null,
        indicacaoId: ref.indicacaoId || null,
        anamneseId: ref.anamneseId || null,
        produtoId: ref.produtoId || null,
      },
    });
  }
}
