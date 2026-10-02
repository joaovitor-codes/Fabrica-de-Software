import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IaService } from '../../ia/ia.service';
import { ReceitaIngredienteDTO } from './dtos/receita-ingrediente';
import { interpretarIngredientesNaoListados } from './ingredientes-ocultos';

/**
 * A lista de ingredientes da receita: validação antes de gravar e a
 * checagem, por IA, de ingredientes citados no modo de preparo que faltam
 * na lista. Usado ao criar e editar receita e na adaptação.
 */
@Injectable()
export class IngredientesReceitaService {
  private readonly logger = new Logger(IngredientesReceitaService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly iaService: IaService,
  ) {}

  /**
   * Confere a lista de ingredientes antes de gravar: repetido ou inexistente
   * daria erro 500 no banco (chave e FK de receita_ingredientes). Devolve os
   * ingredientes, na ordem da lista, para a checagem do modo de preparo.
   */
  async validarIngredientes(itens: ReceitaIngredienteDTO[]) {
    const ids = itens.map((i) => i.ingredienteId);
    const repetidos = [
      ...new Set(ids.filter((id, i) => ids.indexOf(id) !== i)),
    ];
    if (repetidos.length > 0) {
      throw new BadRequestException(
        `Ingrediente repetido na receita: ${repetidos.join(', ')}`,
      );
    }

    const idsUnidades = [...new Set(itens.map((i) => i.unidadeMedidaId))];
    const [ingredientes, unidades] = await Promise.all([
      this.prismaService.ingrediente.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      }),
      this.prismaService.unidadeMedida.findMany({
        where: { id: { in: idsUnidades }, ativo: true },
        select: { id: true },
      }),
    ]);

    const encontrados = new Map(ingredientes.map((i) => [i.id, i]));
    const faltando = ids.filter((id) => !encontrados.has(id));
    if (faltando.length > 0) {
      throw new BadRequestException(
        `Ingrediente não encontrado: ${faltando.join(', ')}`,
      );
    }
    const unidadesOk = new Set(unidades.map((u) => u.id));
    const unidadesFaltando = idsUnidades.filter((id) => !unidadesOk.has(id));
    if (unidadesFaltando.length > 0) {
      throw new BadRequestException(
        `Unidade de medida não encontrada ou inativa: ${unidadesFaltando.join(', ')}`,
      );
    }

    return ids.map((id) => encontrados.get(id)!);
  }

  /**
   * Pergunta à IA quais ingredientes o modo de preparo cita e a lista não
   * tem. Falha da IA não impede salvar a receita: volta lista vazia e fica
   * no log.
   */
  async verificarIngredientesOcultos(
    modoPreparo: string | null | undefined,
    nomesIngredientes: string[],
  ): Promise<string[]> {
    if (!modoPreparo?.trim()) {
      return [];
    }
    try {
      const resposta = await this.iaService.ingredientesNaoListados(
        modoPreparo,
        nomesIngredientes,
      );
      return interpretarIngredientesNaoListados(resposta);
    } catch (erro) {
      this.logger.error(
        `Falha ao conferir ingredientes do modo de preparo: ${erro}`,
      );
      return [];
    }
  }

  /** Aviso ao autor quando a IA apontou ingrediente fora da lista. */
  avisoIngredientesOcultos(ingredientesNaoListados: string[]) {
    if (ingredientesNaoListados.length === 0) {
      return {};
    }
    return {
      aviso:
        `O modo de preparo cita ingredientes que não estão na lista: ` +
        `${ingredientesNaoListados.join(', ')}. Inclua-os na receita: ` +
        `enquanto isso, ela não aparece para quem tem alergia ou restrição grave.`,
    };
  }
}
