import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import {
  Receita,
  StatusReceita,
  TipoMidia,
  TipoRestricao,
  TipoUsuario,
} from '@prisma/client';
import { ReceitaDto } from './dtos/receita';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UpdateReceitaDto } from './dtos/update-receita';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { IngredientesReceitaService } from './ingredientes-receita.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import {
  clausulaSegura,
  restricoesDoUsuario,
} from '../visibilidade/restricoes-receita';

/**
 * Receita: criar, editar, apagar, listar, abrir e mídia. Quem vê o quê fica
 * em VisibilidadeReceitaService; favoritos, curadoria e adaptação têm
 * módulos próprios em receitas/.
 */
@Injectable()
export class ReceitaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usuario: UsuarioService,
    private readonly cacheService: CacheService,
    private readonly visibilidade: VisibilidadeReceitaService,
    private readonly ingredientesReceita: IngredientesReceitaService,
  ) {}

  async create(data: ReceitaDto, userId: string) {
    await this.cacheService.del('receitas:all');

    const userExists = await this.usuario.userExists(userId);

    if (!userExists) {
      throw new BadRequestException('Usuário não encontrado');
    }

    if (!data.ingredientes || data.ingredientes.length === 0) {
      throw new BadRequestException(
        'A receita deve ter pelo menos um ingrediente',
      );
    }

    const ingredientes = await this.ingredientesReceita.validarIngredientes(
      data.ingredientes,
    );
    const ingredientesNaoListados =
      await this.ingredientesReceita.verificarIngredientesOcultos(
        data.modoPreparo,
        ingredientes.map((i) => i.nome),
      );

    const receita = await this.prismaService.receita.create({
      data: {
        nome: data.nome,
        descricao: data.descricao,
        modoPreparo: data.modoPreparo,
        ingredientesNaoListados,
        tempoPreparoMin: data.tempoPreparoMin,
        porcoes: data.porcoes,
        nivelDificuldade: data.nivelDificuldade,
        avisoContaminacaoCruzada: data.avisoContaminacaoCruzada,
        criadoPor: userId,

        ingredientes: {
          create: data.ingredientes.map((ingrediente) => ({
            ingredienteId: ingrediente.ingredienteId,
            quantidade: ingrediente.quantidade,
            unidadeMedidaId: ingrediente.unidadeMedidaId,
          })),
        },
      },
      include: {
        ingredientes: {
          include: {
            ingrediente: true,
            unidadeMedida: true,
          },
        },
      },
    });
    return {
      success: 'Receita criada com sucesso.',
      ...this.ingredientesReceita.avisoIngredientesOcultos(
        ingredientesNaoListados,
      ),
      data: receita,
    };
  }

  async uploadMedia(
    id: string,
    file: Express.Multer.File,
    tipo: TipoMidia,
    ordem: number,
    usuario: UsuarioAutenticado,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'video/mp4'];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      await unlink(file.path).catch(() => undefined);

      throw new BadRequestException('invalid file type');
    }

    const maxSize = 5 * 1024 * 1024;

    if (file.size > maxSize) {
      await unlink(file.path).catch(() => undefined);

      throw new BadRequestException('file is too large!');
    }

    try {
      await this.garantirAutorOuAdmin(id, usuario);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);

      throw error;
    }

    let folder: string;

    if (file.fieldname === 'image') {
      folder = 'images';
    } else if (file.fieldname === 'video') {
      folder = 'videos';
    } else {
      await unlink(file.path).catch(() => undefined);

      throw new BadRequestException('Invalid file field');
    }

    try {
      const midia = await this.prismaService.receitaMidia.create({
        data: {
          receitaId: id,
          url: `/uploads/receitas/${folder}/${file.filename}`,
          tipo,
          ordem,
        },
      });

      return {
        success: 'Mídia enviada com sucesso.',
        data: midia,
      };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);

      throw error;
    }
  }

  async findAll(usuario?: UsuarioAutenticado, seguraPara?: string) {
    // Só a lista pública (visitante sem login, sem filtro) vai para o cache:
    // a de quem está logado depende do usuário.
    const cacheKey = 'receitas:all';
    const usaCache = !usuario && !seguraPara;

    if (usaCache) {
      const cachedReceitas = await this.cacheService.get<Receita[]>(cacheKey);

      if (cachedReceitas) {
        return cachedReceitas;
      }
    }

    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receitas = await this.prismaService.receita.findMany({
      where: {
        deletedAt: null,
        AND: [
          this.visibilidade.filtroVisibilidade(usuario, restricoes),
          await this.visibilidade.filtroSeguraPara(seguraPara),
        ],
      },
    });

    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    if (usaCache) {
      await this.cacheService.set(cacheKey, receitas, 300_000);
    }

    return this.visibilidade.comRestricoesVioladas(receitas, restricoes);
  }

  async findOne(id: string, usuario?: UsuarioAutenticado) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receita = await this.prismaService.receita.findFirst({
      where: {
        id,
        ...this.visibilidade.filtroVisibilidade(usuario, restricoes),
      },
      include: {
        ingredientes: {
          include: {
            ingrediente: true,
            unidadeMedida: true,
          },
        },
        midias: true,
      },
    });
    if (!receita) {
      return this.visibilidade.naoEncontrada(id, usuario, restricoes);
    }
    const [anotada] = await this.visibilidade.comRestricoesVioladas(
      [receita],
      restricoes,
    );
    return anotada;
  }

  async findByName(
    nome: string,
    usuario?: UsuarioAutenticado,
    seguraPara?: string,
  ) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receita = await this.prismaService.receita.findMany({
      where: {
        nome: { contains: nome, mode: 'insensitive' },
        deletedAt: null,
        AND: [
          this.visibilidade.filtroVisibilidade(usuario, restricoes),
          await this.visibilidade.filtroSeguraPara(seguraPara),
        ],
      },
    });
    if (!receita || receita.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada com esse nome');
    }
    return this.visibilidade.comRestricoesVioladas(receita, restricoes);
  }

  async findIngredients(id: string, usuario?: UsuarioAutenticado) {
    await this.visibilidade.garantirVisivel(id, usuario);

    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: { ingredientes: true },
    });
    return receita!.ingredientes;
  }

  /**
   * Alertas de restrição alimentar da receita: cada restrição vinculada a
   * algum ingrediente dela, com os ingredientes que a disparam, e os
   * ingredientes que ninguém revisou ainda (a falta de vínculo neles não
   * garante nada).
   */
  async findAlerts(id: string, usuario?: UsuarioAutenticado) {
    await this.visibilidade.garantirVisivel(id, usuario);

    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      select: {
        avisoContaminacaoCruzada: true,
        ingredientes: {
          select: {
            ingrediente: {
              select: {
                id: true,
                nome: true,
                restricoesRevisadasEm: true,
                restricoes: {
                  select: {
                    restricao: { select: { id: true, nome: true, tipo: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const porRestricao = new Map<
      string,
      {
        id: string;
        nome: string;
        tipo: TipoRestricao;
        ingredientes: { id: string; nome: string }[];
      }
    >();
    const ingredientesNaoRevisados: { id: string; nome: string }[] = [];
    for (const { ingrediente } of receita!.ingredientes) {
      if (!ingrediente.restricoesRevisadasEm) {
        ingredientesNaoRevisados.push({
          id: ingrediente.id,
          nome: ingrediente.nome,
        });
      }
      for (const { restricao } of ingrediente.restricoes) {
        const alerta = porRestricao.get(restricao.id) ?? {
          ...restricao,
          ingredientes: [],
        };
        alerta.ingredientes.push({
          id: ingrediente.id,
          nome: ingrediente.nome,
        });
        porRestricao.set(restricao.id, alerta);
      }
    }

    return {
      avisoContaminacaoCruzada: receita!.avisoContaminacaoCruzada,
      restricoes: [...porRestricao.values()],
      ingredientesNaoRevisados,
    };
  }

  async findSuggestions(usuario?: UsuarioAutenticado) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        deletedAt: null,
        OR: [{ nivelDificuldade: 'facil' }, { nivelDificuldade: 'medio' }],
        AND: [this.visibilidade.semPrivadasDeOutros(usuario)],
        ...clausulaSegura(restricoes.filter((r) => r.estrita)),
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    return this.visibilidade.comRestricoesVioladas(receitas, restricoes);
  }

  async findValidated(usuario?: UsuarioAutenticado) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        deletedAt: null,
        AND: [this.visibilidade.semPrivadasDeOutros(usuario)],
        ...clausulaSegura(restricoes.filter((r) => r.estrita)),
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }
    return this.visibilidade.comRestricoesVioladas(receitas, restricoes);
  }

  async findFeedbacks(_id: string) {} // TODO: Implementar o método de encontrar feedbacks para uma receita

  async update(
    id: string,
    updateReceita: UpdateReceitaDto,
    usuario: UsuarioAutenticado,
  ) {
    const cacheKey = 'receitas:all';

    // Modo de preparo ou lista de ingredientes novos: confere de novo os
    // ingredientes citados. Fora da transação (a IA demora) e só depois de
    // checar o autor, para ninguém gastar chamada de IA numa receita que não
    // pode editar.
    const novosIngredientes = updateReceita.ingredientes;
    let ingredientesNaoListados: string[] | undefined;
    if (
      updateReceita.modoPreparo !== undefined ||
      novosIngredientes !== undefined
    ) {
      await this.garantirAutorOuAdmin(id, usuario);

      const nomes = novosIngredientes
        ? (
            await this.ingredientesReceita.validarIngredientes(
              novosIngredientes,
            )
          ).map((i) => i.nome)
        : (
            await this.prismaService.receitaIngrediente.findMany({
              where: { receitaId: id },
              select: { ingrediente: { select: { nome: true } } },
            })
          ).map((i) => i.ingrediente.nome);

      const modoPreparo =
        updateReceita.modoPreparo !== undefined
          ? updateReceita.modoPreparo
          : (
              await this.prismaService.receita.findUnique({
                where: { id },
                select: { modoPreparo: true },
              })
            )?.modoPreparo;

      ingredientesNaoListados =
        await this.ingredientesReceita.verificarIngredientesOcultos(
          modoPreparo,
          nomes,
        );
    }

    return this.prismaService.$transaction(async (tx) => {
      const receitaAtual = await tx.receita.findUnique({ where: { id } });

      if (!receitaAtual || receitaAtual.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }

      this.verificarAutorOuAdmin(receitaAtual.criadoPor, usuario);

      await this.cacheService.del(cacheKey);

      if (receitaAtual.status === 'aprovada') {
        await tx.receitaVersao.create({
          data: {
            receitaId: receitaAtual.id,
            versao: receitaAtual.versaoAtual,
            nome: receitaAtual.nome,
            descricao: receitaAtual.descricao,
            modoPreparo: receitaAtual.modoPreparo,
            alteradoPor: usuario.id,
          },
        });
      }

      // A lista nova substitui a antiga. Como muda o que a receita contém,
      // a receita aprovada volta para curadoria (abaixo), como qualquer edição.
      if (novosIngredientes) {
        await tx.receitaIngrediente.deleteMany({ where: { receitaId: id } });
        await tx.receitaIngrediente.createMany({
          data: novosIngredientes.map((i) => ({
            receitaId: id,
            ingredienteId: i.ingredienteId,
            quantidade: i.quantidade,
            unidadeMedidaId: i.unidadeMedidaId,
          })),
        });
      }

      const receita = await tx.receita.update({
        where: { id },
        data: {
          nome: updateReceita.nome,
          descricao: updateReceita.descricao,
          modoPreparo: updateReceita.modoPreparo,
          ingredientesNaoListados,
          tempoPreparoMin: updateReceita.tempoPreparoMin,
          porcoes: updateReceita.porcoes,
          nivelDificuldade: updateReceita.nivelDificuldade,
          avisoContaminacaoCruzada: updateReceita.avisoContaminacaoCruzada,
          // Conteúdo aprovado que muda precisa de nova curadoria.
          ...(receitaAtual.status === 'aprovada'
            ? {
                versaoAtual: { increment: 1 },
                status: StatusReceita.pendente,
                profissionalAprovadorId: null,
                dataAprovacao: null,
              }
            : {}),
        },
      });

      return {
        success: 'Receita atualizada com sucesso.',
        ...this.ingredientesReceita.avisoIngredientesOcultos(
          ingredientesNaoListados ?? [],
        ),
        data: receita,
      };
    });
  }

  /**
   * Receita usada em algum plano alimentar é só marcada como excluída
   * (deletedAt): some das listagens, mas o plano do paciente continua
   * mostrando. Fora de planos, é apagada de vez. Favoritos saem nos dois casos.
   */
  async remove(id: string, usuario: UsuarioAutenticado) {
    await this.garantirAutorOuAdmin(id, usuario);

    const usadaEmPlano = await this.prismaService.planoAlimentarItem.count({
      where: { receitaId: id },
    });

    await this.prismaService.$transaction(async (tx) => {
      await tx.favorito.deleteMany({ where: { receitaId: id } });

      if (usadaEmPlano > 0) {
        await tx.receita.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        return;
      }

      // A ligação de adaptação sai; a outra receita (origem ou adaptada)
      // continua existindo por conta própria.
      await tx.receitaAdaptacao.deleteMany({
        where: { OR: [{ receitaOrigemId: id }, { receitaAdaptadaId: id }] },
      });
      await tx.receitaVersao.deleteMany({ where: { receitaId: id } });
      await tx.receitaMidia.deleteMany({ where: { receitaId: id } });
      await tx.receitaIngrediente.deleteMany({ where: { receitaId: id } });
      await tx.receita.delete({ where: { id } });
    });

    await this.cacheService.del('receitas:all');
    return { success: 'Receita removida com sucesso.' };
  }

  private verificarAutorOuAdmin(
    criadoPor: string,
    usuario: UsuarioAutenticado,
  ) {
    if (usuario.tipoUsuario !== TipoUsuario.admin && criadoPor !== usuario.id) {
      throw new ForbiddenException(
        'Apenas o autor da receita ou um admin pode realizar esta ação',
      );
    }
  }

  private async garantirAutorOuAdmin(id: string, usuario: UsuarioAutenticado) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      select: { criadoPor: true, deletedAt: true },
    });
    if (!receita || receita.deletedAt) {
      throw new NotFoundException('Receita não encontrada');
    }
    this.verificarAutorOuAdmin(receita.criadoPor, usuario);
  }
}
