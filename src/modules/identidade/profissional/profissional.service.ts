import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  createProfissionalDto,
  UpdateProfissionalDto,
} from './dtos/profissional';
import {
  Prisma,
  Profissional,
  StatusAprovacao,
  StatusProduto,
  TipoUsuario,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateUsuarioDto } from '../usuario/dtos/usuario';
import { ClinicasService } from '../clinicas/clinicas.service';
import { NotificacaoService } from '../../notificacao/notificacao.service';

const SOLICITACAO_EXISTENTE =
  'Já existe uma solicitação profissional pendente ou aprovada para este usuário';

@Injectable()
export class ProfissionalService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clinicaService: ClinicasService,
    private readonly cacheService: CacheService,
    private readonly notificacaoService: NotificacaoService,
  ) {}

  async profissionalExists(id: string): Promise<boolean> {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id },
    });
    return !!profissional;
  }

  async solicitarCadastroProfissional(
    userId: string,
    dto: createProfissionalDto,
  ) {
    if (dto.clinicaId) {
      const clinicaExiste = await this.clinicaService.clinicaExists(
        dto.clinicaId,
      );
      if (!clinicaExiste) {
        throw new NotFoundException('Clínica não encontrada');
      }
    }

    const usuario = await this.prismaService.usuario.findUnique({
      where: { id: userId },
      include: { profissional: true },
    });

    if (!usuario) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (usuario.profissional) {
      if (usuario.profissional.statusAprovacao !== StatusAprovacao.rejeitado) {
        throw new ConflictException(SOLICITACAO_EXISTENTE);
      }

      const reaberta = await this.prismaService.profissional.update({
        where: { id: usuario.profissional.id },
        data: {
          registroProfissional: dto.registroProfissional,
          especialidade: dto.especialidade,
          bio: dto.bio,
          clinicaId: dto.clinicaId,
          statusAprovacao: StatusAprovacao.pendente,
          aprovadoPor: null,
          aprovadoEm: null,
        },
      });
      await this.limparCacheDoMe(userId);
      return reaberta;
    }

    // A conta só vira profissional na aprovação do admin: o tipo é o que
    // libera as rotas e a visão de equipe.
    let solicitacao: Profissional;
    try {
      solicitacao = await this.prismaService.profissional.create({
        data: {
          usuarioId: userId,
          registroProfissional: dto.registroProfissional,
          especialidade: dto.especialidade,
          bio: dto.bio,
          clinicaId: dto.clinicaId,
          statusAprovacao: StatusAprovacao.pendente,
        },
      });
    } catch (error) {
      // Duplo clique: o outro pedido criou a solicitação primeiro
      // (usuarioId é único).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(SOLICITACAO_EXISTENTE);
      }
      throw error;
    }
    await this.limparCacheDoMe(userId);
    return solicitacao;
  }

  /**
   * Aprovar e rejeitar só valem sobre a solicitação pendente, conferida na
   * própria gravação: dois admins agindo ao mesmo tempo não aprovam e
   * rejeitam a mesma solicitação (a rejeição gravando por último deixava a
   * conta profissional com o cadastro rejeitado).
   */
  async aprovarCadastroProfissional(adminId: string, profissionalId: string) {
    const solicitacao = await this.prismaService.profissional.findUnique({
      where: { id: profissionalId },
    });
    if (!solicitacao) {
      throw new NotFoundException('Profissional não encontrado');
    }

    // A conta vira profissional antes do status: o trigger do banco só
    // aceita cadastro aprovado em conta profissional. Se a solicitação já
    // não estiver pendente, a transação desfaz a mudança da conta.
    // Gravar a conta primeiro também trava a linha do usuário, que é o que
    // enfileira esta aprovação com quem reativa uma venda (ver
    // garantirNaoProfissional).
    const aprovado = await this.prismaService.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: solicitacao.usuarioId },
        data: { tipoUsuario: TipoUsuario.profissional },
      });
      const avaliado = await this.avaliarPendente(tx, profissionalId, {
        statusAprovacao: StatusAprovacao.aprovado,
        aprovadoPor: adminId,
        aprovadoEm: new Date(),
      });
      await this.tirarVendasDoAr(tx, solicitacao.usuarioId);
      return avaliado;
    });
    await this.limparCacheDoMe(aprovado.usuarioId);
    return aprovado;
  }

  /**
   * D4/D5: o profissional não vende receita nem anuncia produto. O que o
   * usuário tinha à venda sai do ar na aprovação (oferta pausada, produto
   * pausado), com um aviso por item. Compras já feitas não mudam.
   */
  private async tirarVendasDoAr(
    tx: Prisma.TransactionClient,
    usuarioId: string,
  ) {
    const ofertas = await tx.receitaOferta.findMany({
      where: { ativa: true, receita: { criadoPor: usuarioId } },
      select: {
        id: true,
        receita: { select: { id: true, nome: true, deletedAt: true } },
      },
    });
    const produtos = await tx.produto.findMany({
      where: {
        vendedorId: usuarioId,
        status: StatusProduto.ativo,
        deletedAt: null,
      },
      select: { id: true, titulo: true },
    });

    if (ofertas.length) {
      await tx.receitaOferta.updateMany({
        where: { id: { in: ofertas.map((o) => o.id) } },
        data: { ativa: false },
      });
    }
    if (produtos.length) {
      await tx.produto.updateMany({
        where: { id: { in: produtos.map((p) => p.id) } },
        data: { status: StatusProduto.pausado },
      });
    }

    // Receita apagada não aparece para o autor: pausa sem avisar.
    for (const { receita } of ofertas.filter((o) => !o.receita.deletedAt)) {
      await this.notificacaoService.criar(
        {
          usuarioId,
          codigo: 'receita_venda_pausada',
          titulo: 'A venda da sua receita foi pausada',
          mensagem: `Com o cadastro profissional aprovado, a receita "${receita.nome}" saiu da vitrine: o código de ética do nutricionista não permite vender receitas. Quem já comprou continua com acesso.`,
          referencia: { receitaId: receita.id },
        },
        tx,
      );
    }
    for (const produto of produtos) {
      await this.notificacaoService.criar(
        {
          usuarioId,
          codigo: 'produto_pausado',
          titulo: 'Seu produto foi pausado',
          mensagem: `Com o cadastro profissional aprovado, o produto "${produto.titulo}" saiu da vitrine: o código de ética do nutricionista não permite anunciar produtos.`,
          referencia: { produtoId: produto.id },
        },
        tx,
      );
    }
  }

  async rejeitarCadastroProfissional(adminId: string, profissionalId: string) {
    const rejeitado = await this.avaliarPendente(
      this.prismaService,
      profissionalId,
      {
        statusAprovacao: StatusAprovacao.rejeitado,
        aprovadoPor: adminId,
        aprovadoEm: new Date(),
      },
    );
    await this.limparCacheDoMe(rejeitado.usuarioId);
    return rejeitado;
  }

  /** Grava a avaliação se a solicitação ainda está pendente; senão, 404/409. */
  private async avaliarPendente(
    db: Prisma.TransactionClient,
    profissionalId: string,
    data: Prisma.ProfissionalUncheckedUpdateManyInput,
  ) {
    const { count } = await db.profissional.updateMany({
      where: { id: profissionalId, statusAprovacao: StatusAprovacao.pendente },
      data,
    });
    const profissional = await db.profissional.findUnique({
      where: { id: profissionalId },
    });
    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }
    if (count === 0) {
      throw new ConflictException('Esta solicitação já foi avaliada');
    }
    return profissional;
  }

  /** O /auth/me mostra o tipo da conta e o status do cadastro. */
  private limparCacheDoMe(usuarioId: string) {
    return this.cacheService.del(`auth:me:${usuarioId}`);
  }

  async listarProfissionaisPendentes(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prismaService.profissional.findMany({
        where: { statusAprovacao: StatusAprovacao.pendente },
        skip,
        take: limit,
        include: { usuario: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.profissional.count({
        where: { statusAprovacao: StatusAprovacao.pendente },
      }),
    ]);

    return {
      data,
      meta: { total, page, last_page: Math.ceil(total / limit), limit },
    };
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    statusAprovacao?: StatusAprovacao,
  ) {
    const skip = (page - 1) * limit;
    const where = statusAprovacao ? { statusAprovacao } : {};

    const [data, total] = await Promise.all([
      this.prismaService.profissional.findMany({
        where,
        skip,
        take: limit,
        include: { usuario: true, clinica: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.profissional.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, last_page: Math.ceil(total / limit), limit },
    };
  }

  async findOne(id: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id },
      include: { usuario: true, clinica: true },
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }

    return profissional;
  }

  async findByUsuarioId(usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
      include: { usuario: true, clinica: true },
    });

    if (!profissional) {
      throw new NotFoundException(
        'Você ainda não possui cadastro profissional',
      );
    }

    return profissional;
  }

  async update(id: string, data: UpdateProfissionalDto) {
    try {
      return await this.prismaService.profissional.update({
        where: { id },
        data: {
          especialidade: data.especialidade,
          bio: data.bio,
          clinicaId: data.clinicaId,
        },
        include: { clinica: true },
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Profissional não encontrado');
      }
      throw error;
    }
  }

  async exigirProfissionalAprovado(profissionalId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id: profissionalId },
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }

    if (profissional.statusAprovacao !== StatusAprovacao.aprovado) {
      throw new UnauthorizedException(
        'Apenas profissionais aprovados podem realizar esta ação',
      );
    }

    return profissional;
  }

  async associarPaciente(profissionalId: string, pacienteId: string) {
    await this.exigirProfissionalAprovado(profissionalId);

    // A condição vai na própria gravação: dois profissionais associando o
    // mesmo paciente ao mesmo tempo não recebem os dois 200.
    const { count } = await this.prismaService.paciente.updateMany({
      where: {
        id: pacienteId,
        OR: [{ profissionalId: null }, { profissionalId }],
      },
      data: { profissionalId },
    });
    const paciente = await this.prismaService.paciente.findUnique({
      where: { id: pacienteId },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }
    if (count === 0) {
      throw new ConflictException(
        'Este paciente já possui um profissional responsável',
      );
    }
    return paciente;
  }

  async criarNovoPacienteAssociado(
    data: CreateUsuarioDto,
    profissionalId: string,
  ) {
    await this.exigirProfissionalAprovado(profissionalId);

    const hashedPassword = await bcrypt.hash(data.password, 10);

    try {
      return await this.prismaService.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            nome: data.name,
            tipoUsuario: TipoUsuario.paciente,
            dataNascimento: data.dataNascimento
              ? new Date(data.dataNascimento)
              : undefined,
            fotoPerfilUrl: data.fotoPerfilUrl,
            conta: {
              create: {
                email: data.email,
                senhaHash: hashedPassword,
              },
            },
          },
          include: { conta: true },
        });

        const paciente = await tx.paciente.create({
          data: {
            usuarioId: usuario.id,
            profissionalId,
          },
        });

        return { usuario, paciente };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (error.meta?.target as string | string[] | undefined)?.includes('email')
      ) {
        throw new ConflictException('Email já está em uso');
      }
      throw new BadRequestException(
        'Não foi possível criar o paciente. Verifique os dados e tente novamente.',
      );
    }
  }

  async listarPacientesDoProfissional(profissionalId: string) {
    return this.prismaService.paciente.findMany({
      where: {
        profissionalId: profissionalId,
      },
      include: {
        usuario: {
          select: {
            nome: true,
            fotoPerfilUrl: true,
            dataNascimento: true,
            conta: {
              select: {
                email: true,
              },
            },
          },
        },
        dadosSocioeconomicos: true,
      },
      orderBy: {
        usuario: {
          nome: 'asc',
        },
      },
    });
  }
}
