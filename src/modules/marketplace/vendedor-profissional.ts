import { ForbiddenException } from '@nestjs/common';
import { Prisma, StatusAprovacao } from '@prisma/client';

export const PROFISSIONAL_NAO_VENDE_RECEITA =
  'Profissional não vende receitas (código de ética do nutricionista).';
export const PROFISSIONAL_NAO_ANUNCIA_PRODUTO =
  'Profissional não anuncia produtos (código de ética do nutricionista).';

/**
 * D4/D5: quem tem cadastro profissional aprovado não vende receita nem
 * anuncia produto. Vale para todo caminho que põe algo à venda (criar,
 * reativar), e tem de rodar na mesma transação da gravação.
 *
 * Trava a linha do usuário antes de conferir. A aprovação grava essa mesma
 * linha antes de tirar tudo do ar, então os dois se enfileiram: ou quem
 * reativa espera a aprovação e enxerga o cadastro aprovado, ou a aprovação
 * espera e pausa o que acabou de ser reativado.
 */
export async function garantirNaoProfissional(
  tx: Prisma.TransactionClient,
  usuarioId: string,
  mensagem: string,
) {
  await tx.$queryRaw`SELECT 1 FROM usuarios WHERE id = ${usuarioId}::uuid FOR SHARE`;
  const profissional = await tx.profissional.findFirst({
    where: { usuarioId, statusAprovacao: StatusAprovacao.aprovado },
    select: { id: true },
  });
  if (profissional) {
    throw new ForbiddenException(mensagem);
  }
}
