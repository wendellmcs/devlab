import { randomUUID } from 'node:crypto'
import path from 'node:path/posix'
import { Writable, type Duplex } from 'node:stream'
import type Docker from 'dockerode'

import { config } from '../config.ts'
import { log } from '../log.ts'
import { docker, ErroDeLab } from '../docker/cliente.ts'
import type { Licao } from '../conteudo/schema.ts'
import { descreverLimites, montarHostConfig } from './limites.ts'
import type { LabInfo, Recursos, ResultadoExec } from './tipos.ts'

const ROTULO_GERENCIADO = 'devlab.gerenciado'
/** Porta do agente dono do container: é o que separa uma instância da outra. */
const ROTULO_PORTA = 'devlab.porta'
const DIR_TRABALHO_INTERNO = '/tmp/devlab'

/**
 * Códigos fora da faixa 0–255 do POSIX, para não colidir com saída real.
 *
 * `CODIGO_INDETERMINADO` é o ponto sensível: o código de saída é a única fonte
 * da verdade do Verifier Runner, e `esperado_exit` vale 0 por padrão. Assumir
 * 0 quando não se conseguiu ler o código transformaria uma queda do socket do
 * Docker — ou o lab ser destruído no meio da verificação — em lição aprovada
 * com XP creditado sem o aluno ter feito nada. E conclusão não é reversível.
 */
const CODIGO_INDETERMINADO = -1
const CODIGO_EXPIROU = 124

export type OpcoesExec = {
  usuario?: string
  workdir?: string
  timeoutMs?: number
  env?: string[]
}

export type SessaoTerminal = {
  stream: Duplex
  redimensionar(cols: number, rows: number): Promise<void>
  encerrar(): void
}

type LabInterno = {
  info: LabInfo
  container: Docker.Container
  licao: Licao
  /** Últimos bytes do terminal, usados para classificar erros reais. */
  saida: string
}

/**
 * Lab Manager — ciclo de vida dos containers descartáveis.
 *
 * Regra da casa: o lab é gado, não bicho de estimação. Qualquer coisa pode ser
 * destruída e recriada em segundos, e é isso que torna seguro deixar o aluno
 * quebrar o ambiente de propósito.
 */
export class GerenciadorDeLabs {
  readonly #labs = new Map<string, LabInterno>()
  /**
   * Fila por lab: reset, destruição e coleta por TTL não podem se atropelar.
   * Sem isso, um DELETE que chega durante um reset remove o container antigo,
   * tira o lab do mapa, e o reset em andamento cria um container novo que
   * ninguém mais conhece — órfão até o próximo boot do agente.
   */
  readonly #filas = new Map<string, Promise<unknown>>()
  #coletor: NodeJS.Timeout | null = null

  iniciarColetor(): void {
    if (this.#coletor !== null) return
    this.#coletor = setInterval(() => {
      void this.coletarOciosos()
    }, config.intervaloColetorMs)
    this.#coletor.unref()
  }

  pararColetor(): void {
    if (this.#coletor !== null) clearInterval(this.#coletor)
    this.#coletor = null
  }

  listar(): LabInfo[] {
    return [...this.#labs.values()].map((l) => instantaneo(l.info))
  }

  obter(labId: string): LabInfo | undefined {
    const interno = this.#labs.get(labId)
    return interno === undefined ? undefined : instantaneo(interno.info)
  }

  licaoDoLab(labId: string): Licao | undefined {
    return this.#labs.get(labId)?.licao
  }

  // ── ciclo de vida ────────────────────────────────────────────────────────

  async criar(licao: Licao): Promise<LabInfo> {
    await this.#garantirImagem(licao.lab.imagem)

    const labId = randomUUID().slice(0, 8)
    const container = await this.#criarContainer(labId, licao)

    const info: LabInfo = {
      id: labId,
      containerId: container.id,
      licaoId: licao.id,
      imagem: licao.lab.imagem,
      usuario: licao.lab.usuario,
      workdir: licao.lab.workdir,
      estado: 'subindo',
      criadoEm: Date.now(),
      ultimaAtividade: Date.now(),
      resets: 0,
      limites: descreverLimites(licao.lab),
    }

    const interno: LabInterno = { info, container, licao, saida: '' }
    this.#labs.set(labId, interno)

    try {
      await this.#prepararEstadoInicial(interno)
      info.estado = 'pronto'
      log.info(`lab ${labId} pronto`, { licao: licao.id, imagem: licao.lab.imagem })
    } catch (e) {
      // O lab nunca chegou a existir para quem chamou: `criar()` lança, então o
      // cliente recebe 500 e NUNCA fica sabendo o labId — não tem como mandar
      // DELETE depois. Deixar o container de pé e a entrada no mapa queimava
      // uma vaga do teto de labs simultâneos por lição quebrada, até o TTL de
      // 45 min. Some com os dois aqui: quem falhou não ocupa lugar.
      info.estado = 'erro'
      info.erro = e instanceof Error ? e.message : String(e)
      log.erro(`falha ao preparar o lab ${labId}`, e)
      this.#labs.delete(labId)
      await this.#removerContainer(container)
      throw e
    }

    return instantaneo(info)
  }

  /**
   * Reset: destrói o container e recria do zero a partir da imagem, reaplicando
   * setup e injeção de falha. O id do lab é preservado para a UI não precisar
   * reconectar tudo.
   */
  reiniciar(labId: string): Promise<LabInfo> {
    return this.#emFila(labId, () => this.#reiniciarAgora(labId))
  }

  async #reiniciarAgora(labId: string): Promise<LabInfo> {
    const interno = this.#obrigatorio(labId)
    const { licao } = interno

    await this.#removerContainer(interno.container)

    const container = await this.#criarContainer(labId, licao)

    // O lab pode ter sido destruído enquanto o container novo subia. Se foi,
    // este container não tem dono: some com ele em vez de deixá-lo órfão.
    if (this.#labs.get(labId) !== interno) {
      await this.#removerContainer(container)
      throw new ErroDeLab('lab_inexistente', `lab '${labId}' foi destruído durante o reset`)
    }

    interno.container = container
    interno.saida = ''
    interno.info.containerId = container.id
    interno.info.estado = 'subindo'
    interno.info.resets += 1
    interno.info.ultimaAtividade = Date.now()
    delete interno.info.erro

    try {
      await this.#prepararEstadoInicial(interno)
      interno.info.estado = 'pronto'
      log.info(`lab ${labId} reiniciado`, { resets: interno.info.resets })
    } catch (e) {
      interno.info.estado = 'erro'
      interno.info.erro = e instanceof Error ? e.message : String(e)
      throw e
    }

    return instantaneo(interno.info)
  }

  destruir(labId: string): Promise<void> {
    return this.#emFila(labId, async () => {
      const interno = this.#labs.get(labId)
      if (interno === undefined) return
      this.#labs.delete(labId)
      this.#filas.delete(labId)
      interno.info.estado = 'destruido'
      await this.#removerContainer(interno.container)
      log.info(`lab ${labId} destruído`)
    })
  }

  /** Serializa as operações de um mesmo lab, na ordem em que chegaram. */
  #emFila<T>(labId: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = this.#filas.get(labId) ?? Promise.resolve()
    const proxima = anterior.then(tarefa, tarefa)
    // A fila não pode morrer por causa de uma tarefa que falhou.
    this.#filas.set(
      labId,
      proxima.then(
        () => undefined,
        () => undefined,
      ),
    )
    return proxima
  }

  async destruirTodos(): Promise<void> {
    await Promise.allSettled([...this.#labs.keys()].map((id) => this.destruir(id)))
  }

  /**
   * Containers de execuções anteriores que sobreviveram a um encerramento
   * abrupto.
   *
   * O filtro inclui a PORTA do agente. Sem isso a varredura é global e um
   * segundo agente subindo — `npm run fumaca` (7799) enquanto `npm run dev`
   * (7788) está de pé, ou um `devlab iniciar` aberto por engano duas vezes —
   * destruía o lab que o aluno estava usando no meio da lição. Cada instância
   * só recolhe o lixo que ela mesma poderia ter deixado.
   */
  async limparOrfaos(): Promise<number> {
    const emUso = new Set([...this.#labs.values()].map((l) => l.container.id))
    let removidos = 0
    try {
      const lista = await docker().listContainers({
        all: true,
        filters: {
          label: [`${ROTULO_GERENCIADO}=true`, `${ROTULO_PORTA}=${String(config.porta)}`],
        },
      })
      for (const c of lista) {
        if (emUso.has(c.Id)) continue
        await this.#removerContainer(docker().getContainer(c.Id))
        removidos += 1
      }
      if (removidos > 0) log.info(`removidos ${removidos} lab(s) órfão(s)`)
    } catch (e) {
      log.aviso('não foi possível varrer labs órfãos', e)
    }
    return removidos
  }

  async coletarOciosos(): Promise<void> {
    const limite = Date.now() - config.ttlLabOciosoMs
    for (const [id, interno] of this.#labs) {
      if (interno.info.ultimaAtividade < limite) {
        log.info(`lab ${id} ocioso além do TTL — destruindo`)
        await this.destruir(id).catch((e: unknown) => log.aviso('falha ao coletar lab', e))
      }
    }
  }

  registrarAtividade(labId: string): void {
    const interno = this.#labs.get(labId)
    if (interno !== undefined) interno.info.ultimaAtividade = Date.now()
  }

  // ── execução ─────────────────────────────────────────────────────────────

  async exec(labId: string, cmd: string[], opcoes: OpcoesExec = {}): Promise<ResultadoExec> {
    const interno = this.#obrigatorio(labId)
    interno.info.ultimaAtividade = Date.now()

    const limiteMs = opcoes.timeoutMs ?? config.timeoutCheckMs

    // O timeout tem de acontecer DENTRO do container. Destruir o stream do
    // lado do agente encerra só a conexão: o processo continua vivo lá dentro
    // consumindo CPU e PIDs, e cada nova tentativa de verificar empilha mais
    // um até estourar o PidsLimit e inutilizar o lab. `timeout` é coreutils,
    // presente em qualquer imagem de lab, e devolve 124 ao matar.
    const segundos = Math.max(1, Math.ceil(limiteMs / 1000))
    const comando = ['timeout', '-k', '5', String(segundos), ...cmd]

    const exec = await interno.container.exec({
      Cmd: comando,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: opcoes.usuario ?? 'root',
      WorkingDir: opcoes.workdir ?? interno.info.workdir,
      Env: opcoes.env,
    })

    const stream = await exec.start({ hijack: true, stdin: false })
    const pedacosSaida: Buffer[] = []
    const pedacosErro: Buffer[] = []
    docker().modem.demuxStream(stream, coletor(pedacosSaida), coletor(pedacosErro))

    // Rede de segurança: se o `timeout` de dentro do container não resolver
    // (imagem sem coreutils, daemon travado), o agente ainda se solta.
    let expirou = false
    const timer = setTimeout(() => {
      expirou = true
      stream.destroy()
    }, limiteMs + 5_000)

    await esperarFim(stream)
    clearTimeout(timer)

    const codigoLido = expirou ? CODIGO_EXPIROU : await lerCodigoDeSaida(exec)
    // 124 vindo do próprio `timeout` também é estouro de tempo.
    if (codigoLido === CODIGO_EXPIROU) expirou = true
    const saidaCodigo = codigoLido

    return {
      exit: saidaCodigo,
      stdout: Buffer.concat(pedacosSaida).toString('utf8'),
      stderr: Buffer.concat(pedacosErro).toString('utf8'),
      expirou,
      indeterminado: saidaCodigo === CODIGO_INDETERMINADO,
    }
  }

  /** Grava um arquivo dentro do lab sem bind mount: conteúdo entra por cópia. */
  async escreverArquivo(
    labId: string,
    caminho: string,
    conteudo: string,
    modo = '0644',
  ): Promise<void> {
    if (caminho.includes("'")) {
      throw new ErroDeLab('caminho_invalido', `caminho com aspas simples não é suportado: ${caminho}`)
    }
    const b64 = Buffer.from(conteudo, 'utf8').toString('base64')
    const dir = path.dirname(caminho)
    const comando =
      `mkdir -p '${dir}' && ` +
      `printf '%s' '${b64}' | base64 -d > '${caminho}' && ` +
      `chmod ${modo} '${caminho}'`

    const r = await this.exec(labId, ['/bin/bash', '-c', comando], { usuario: 'root' })
    if (r.exit !== 0) {
      throw new ErroDeLab(
        'escrita_falhou',
        `não foi possível gravar ${caminho} no lab`,
        r.stderr || r.stdout,
      )
    }
  }

  /** Copia um script para dentro do lab e o executa. */
  async rodarScript(
    labId: string,
    nome: string,
    corpo: string,
    opcoes: OpcoesExec = {},
  ): Promise<ResultadoExec> {
    const destino = `${DIR_TRABALHO_INTERNO}/${nome.replace(/[^a-zA-Z0-9._-]/g, '_')}.sh`
    await this.escreverArquivo(labId, destino, corpo, '0755')
    return this.exec(labId, ['/bin/bash', destino], opcoes)
  }

  // ── terminal ─────────────────────────────────────────────────────────────

  /**
   * PTY Bridge: `docker exec` com TTY alocado dentro do container.
   * Cada aba de terminal abre a sua própria sessão sobre o mesmo lab.
   */
  async abrirTerminal(
    labId: string,
    opcoes: { cols: number; rows: number },
  ): Promise<SessaoTerminal> {
    const interno = this.#obrigatorio(labId)
    interno.info.ultimaAtividade = Date.now()

    const usuario = interno.info.usuario
    const home = usuario === 'root' ? '/root' : `/home/${usuario}`

    const exec = await interno.container.exec({
      Cmd: ['/bin/bash', '-l'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: usuario,
      WorkingDir: interno.info.workdir,
      Env: [`HOME=${home}`, `USER=${usuario}`, 'TERM=xterm-256color', 'LANG=C.UTF-8', 'DEVLAB=1'],
    })

    const stream = await exec.start({ hijack: true, stdin: true })
    await redimensionarSeguro(exec, opcoes.rows, opcoes.cols)

    return {
      stream,
      redimensionar: (cols, rows) => redimensionarSeguro(exec, rows, cols),
      encerrar: () => {
        stream.destroy()
      },
    }
  }

  /**
   * Guarda a saída recente do terminal para o classificador de erros.
   *
   * Não conta como atividade do aluno: um `tail -f` ou um `top` esquecido
   * imprime sozinho para sempre e manteria o lab vivo além do TTL mesmo com o
   * browser fechado. Atividade é o aluno digitar, e isso o PTY Bridge registra.
   */
  registrarSaida(labId: string, texto: string): void {
    const interno = this.#labs.get(labId)
    if (interno === undefined) return
    const combinado = interno.saida + texto
    interno.saida =
      combinado.length > config.bufferSaidaBytes
        ? combinado.slice(-config.bufferSaidaBytes)
        : combinado
  }

  saidaRecente(labId: string): string {
    return this.#labs.get(labId)?.saida ?? ''
  }

  /**
   * Descarta a saída acumulada. Chamado no início de cada verificação para que
   * a classificação de erro fale do que acabou de acontecer — sem isso, um
   * "No such file or directory" de vinte minutos atrás reaparece como
   * diagnóstico de uma falha que nada tem a ver com ele.
   */
  limparSaida(labId: string): void {
    const interno = this.#labs.get(labId)
    if (interno !== undefined) interno.saida = ''
  }

  // ── recursos ─────────────────────────────────────────────────────────────

  async recursos(labId: string): Promise<Recursos> {
    const interno = this.#obrigatorio(labId)
    const bruto = (await interno.container.stats({ stream: false })) as unknown as EstatisticasDocker
    return calcularRecursos(bruto)
  }

  // ── internos ─────────────────────────────────────────────────────────────

  #obrigatorio(labId: string): LabInterno {
    const interno = this.#labs.get(labId)
    if (interno === undefined) {
      throw new ErroDeLab('lab_inexistente', `lab '${labId}' não existe ou já foi destruído`)
    }
    return interno
  }

  /**
   * Cria e inicia o container, com nova tentativa em falha transitória.
   *
   * No WSL2 o runc conversa com o systemd por dbus para montar o cgroup scope,
   * e essa conversa às vezes cai ("Message recipient disconnected from message
   * bus"). É intermitente e some na tentativa seguinte — mas, sem retentar,
   * viraria um "Resetar lab" que falha sozinho no meio de uma lição.
   */
  async #criarContainer(labId: string, licao: Licao): Promise<Docker.Container> {
    const MAX_TENTATIVAS = 3
    let ultimoErro: unknown

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
      try {
        return await this.#criarContainerUmaVez(labId, licao)
      } catch (e) {
        ultimoErro = e
        if (tentativa === MAX_TENTATIVAS || !ehTransitorio(e)) break
        log.aviso(
          `falha transitória ao subir o lab ${labId} (tentativa ${tentativa}/${MAX_TENTATIVAS})`,
          e,
        )
        await esperar(300 * tentativa)
      }
    }

    throw ultimoErro
  }

  async #criarContainerUmaVez(labId: string, licao: Licao): Promise<Docker.Container> {
    const container = await docker().createContainer({
      name: `devlab-${labId}-${Date.now().toString(36)}`,
      Image: licao.lab.imagem,
      Cmd: ['sleep', 'infinity'],
      Tty: false,
      OpenStdin: false,
      User: 'root',
      WorkingDir: licao.lab.workdir,
      Env: ['LANG=C.UTF-8', 'TERM=xterm-256color', 'DEVLAB=1'],
      Labels: {
        [ROTULO_GERENCIADO]: 'true',
        [ROTULO_PORTA]: String(config.porta),
        'devlab.lab': labId,
        'devlab.licao': licao.id,
      },
      HostConfig: montarHostConfig(licao.lab),
    })

    try {
      await container.start()
    } catch (e) {
      // O container foi criado mas não subiu: some com ele antes de retentar,
      // senão sobra lixo com o rótulo devlab a cada tentativa.
      await this.#removerContainer(container)
      throw e
    }

    return container
  }

  /** Aplica o `setup` e, em labs quebra/conserta, a injeção de falha. */
  async #prepararEstadoInicial(interno: LabInterno): Promise<void> {
    const { licao, info } = interno
    await this.exec(info.id, ['/bin/bash', '-c', `mkdir -p ${DIR_TRABALHO_INTERNO}`], {
      usuario: 'root',
    })

    if (licao.lab.setup !== undefined) {
      const r = await this.rodarScript(info.id, 'setup', licao.lab.setup, {
        usuario: 'root',
        timeoutMs: config.timeoutSetupMs,
      })
      if (r.exit !== 0) {
        throw new ErroDeLab(
          'setup_falhou',
          `o setup da lição '${licao.id}' falhou (exit ${r.exit})`,
          r.stderr || r.stdout,
        )
      }
    }

    if (licao.lab.break !== undefined) {
      const r = await this.rodarScript(info.id, 'break', licao.lab.break, {
        usuario: 'root',
        timeoutMs: config.timeoutSetupMs,
      })
      if (r.exit !== 0) {
        throw new ErroDeLab(
          'injecao_falha_falhou',
          `a injeção de falha da lição '${licao.id}' falhou (exit ${r.exit})`,
          r.stderr || r.stdout,
        )
      }
    }
  }

  async #garantirImagem(tag: string): Promise<void> {
    try {
      await docker().getImage(tag).inspect()
    } catch {
      throw new ErroDeLab(
        'imagem_ausente',
        `a imagem '${tag}' não está no cache local`,
        'Construa as imagens uma vez (é o único passo que precisa de internet): npm run imagens',
      )
    }
  }

  async #removerContainer(container: Docker.Container): Promise<void> {
    try {
      await container.remove({ force: true, v: true })
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // 404: já sumiu (AutoRemove). 409: remoção em andamento. Ambos são o fim desejado.
      if (status !== 404 && status !== 409) log.aviso('falha ao remover container do lab', e)
    }
  }
}

// ── auxiliares ─────────────────────────────────────────────────────────────

/**
 * Lê o código de saída do exec, insistindo enquanto o daemon disser que ainda
 * está rodando. Devolve CODIGO_INDETERMINADO se não der para saber — jamais 0.
 */
async function lerCodigoDeSaida(exec: Docker.Exec): Promise<number> {
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      const detalhes = await exec.inspect()
      if (typeof detalhes.ExitCode === 'number') return detalhes.ExitCode
      // ExitCode null + Running true: o daemon ainda não gravou o código.
      if (detalhes.Running !== true) return CODIGO_INDETERMINADO
      await esperar(50 * tentativa)
    } catch (e) {
      // O exec sumiu junto com o container. Não dá para afirmar sucesso.
      log.debug('não foi possível ler o código de saída do exec', e)
      return CODIGO_INDETERMINADO
    }
  }
  return CODIGO_INDETERMINADO
}

/** Falhas de infraestrutura que somem na tentativa seguinte. */
export function ehTransitorio(erro: unknown): boolean {
  const mensagem = erro instanceof Error ? erro.message : String(erro)
  return /message bus|OCI runtime create failed|unable to apply cgroup|failed to create shim|connection reset|EOF|ETIMEDOUT|EPIPE/i.test(
    mensagem,
  )
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms))
}

/**
 * Cópia do estado do lab para quem está de fora.
 *
 * O gerenciador muta `info` no lugar (containerId novo a cada reset, estado,
 * contador de resets). Devolver a referência viva faria o objeto que o chamador
 * já tem na mão mudar sozinho — inclusive o "antes" com que ele fosse comparar
 * o "depois". Quem sai daqui sai como valor, não como janela para o interno.
 */
function instantaneo(info: LabInfo): LabInfo {
  return { ...info, limites: { ...info.limites } }
}

function coletor(destino: Buffer[]): Writable {
  return new Writable({
    write(pedaco: Buffer, _enc, cb) {
      destino.push(Buffer.from(pedaco))
      cb()
    },
  })
}

/** Resolve no primeiro sinal de fim, inclusive quando o stream é destruído. */
function esperarFim(stream: NodeJS.EventEmitter): Promise<void> {
  return new Promise((resolver) => {
    let feito = false
    const fim = (): void => {
      if (feito) return
      feito = true
      resolver()
    }
    stream.on('end', fim)
    stream.on('close', fim)
    stream.on('error', fim)
  })
}

async function redimensionarSeguro(
  exec: Docker.Exec,
  rows: number,
  cols: number,
): Promise<void> {
  const h = Math.max(1, Math.min(500, Math.trunc(rows)))
  const w = Math.max(1, Math.min(500, Math.trunc(cols)))
  try {
    await exec.resize({ h, w })
  } catch (e) {
    // O exec pode ainda não ter processo anexado, ou já ter terminado.
    log.debug('resize do terminal ignorado', e)
  }
}

type EstatisticasDocker = {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
    online_cpus?: number
  }
  precpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
  }
  memory_stats?: { usage?: number; limit?: number; stats?: { file?: number } }
  pids_stats?: { current?: number }
}

export function calcularRecursos(bruto: EstatisticasDocker): Recursos {
  const MB = 1024 * 1024
  const cpuAtual = bruto.cpu_stats?.cpu_usage?.total_usage ?? 0
  const cpuAnterior = bruto.precpu_stats?.cpu_usage?.total_usage ?? 0
  const sisAtual = bruto.cpu_stats?.system_cpu_usage ?? 0
  const sisAnterior = bruto.precpu_stats?.system_cpu_usage ?? 0
  const nucleos = bruto.cpu_stats?.online_cpus ?? 1

  const deltaCpu = cpuAtual - cpuAnterior
  const deltaSis = sisAtual - sisAnterior
  const cpuPercent =
    deltaCpu > 0 && deltaSis > 0 ? (deltaCpu / deltaSis) * nucleos * 100 : 0

  // `usage` inclui page cache; descontar `file` aproxima o que o cgroup cobra de fato.
  const usadaBruta = bruto.memory_stats?.usage ?? 0
  const cache = bruto.memory_stats?.stats?.file ?? 0
  const usada = Math.max(0, usadaBruta - cache)

  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoriaUsadaMb: Math.round((usada / MB) * 10) / 10,
    memoriaLimiteMb: Math.round((bruto.memory_stats?.limit ?? 0) / MB),
    pids: bruto.pids_stats?.current ?? 0,
  }
}
