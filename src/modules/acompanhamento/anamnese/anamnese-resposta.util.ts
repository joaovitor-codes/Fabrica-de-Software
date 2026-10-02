import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TipoResposta } from '@prisma/client';
import { Decimal, DecimalJsLike } from '@prisma/client/runtime/library';

export type CamposResposta = {
    respostaTexto?: string | null;
    respostaNumero?: Decimal | DecimalJsLike | number | string | null;
    opcaoId?: string | null;
};

const CAMPO_ESPERADO_POR_TIPO: Record<TipoResposta, keyof CamposResposta> = {
    texto: 'respostaTexto',
    numero: 'respostaNumero',
    booleano: 'respostaTexto',
    escolha_unica: 'opcaoId',
    escolha_multipla: 'opcaoId',
};

export function validarCamposPorTipoResposta(tipoResposta: TipoResposta, resposta: CamposResposta) {
    const preenchidos = (['respostaTexto', 'respostaNumero', 'opcaoId'] as const).filter(
        (campo) => resposta[campo] !== undefined && resposta[campo] !== null,
    );

    const campoEsperado = CAMPO_ESPERADO_POR_TIPO[tipoResposta];

    if (preenchidos.length !== 1 || preenchidos[0] !== campoEsperado) {
        throw new BadRequestException(
            `Resposta inválida para pergunta do tipo "${tipoResposta}": apenas o campo "${campoEsperado}" deve ser preenchido.`,
        );
    }
}

export function mapPrismaNotFound(error: unknown, mensagem: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(mensagem);
    }
    throw error;
}
