import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'

import { config } from './config.ts'
import { carregarConteudo } from './conteudo/carregador.ts'
import { diagnosticarDaemon, docker } from './docker/cliente.ts'
import { ProvedorOllama } from './ia/ollama.ts'

export type EstadoVerificacao = 'ok' | 'aviso' | 'falha'

export type Verificacao = {
  id: string
  titulo: string
  estado: EstadoVerificacao
  detalhe: string
  correcao?: string
}

export type RelatorioDoctor = {
  pronto: boolean
  verificacoes: Verificacao[]
  em: number
}

const GB = 1024 ** 3
const ESPACO_RECOMENDADO_GB = 25

export async function rodarDoctor(): Promise<RelatorioDoctor> {
  const verificacoes = [
    verificarNode(),
    await verificarSistema(),
    await verificarCgroupV2(),
    await verificarDocker(),
    await verificarImagens(),
    await verificarEspaco(),
    await verificarPorta(config.porta, 'agente'),
    await verificarPorta(5173, 'interface'),
    await verificarConteudo(),
    await verificarIa(),
  ]

  return {
    pronto: verificacoes.every((v) => v.estado !== 'falha'),
    verificacoes,
    em: Date.now(),
  }
}

function verificarNode(): Verificacao {
  const maior = Number(process.versions.node.split('.')[0] ?? 0)
  const ok = maior >= config.versaoNodeMinima

  if (ok) {
    return {
      id: 'node',
      titulo: 'Node.js',
      estado: 'ok',
      detalhe: `v${process.versions.node} · ${process.execPath}`,
    }
  }

  // Caso clássico e confuso: existe um Node novo instalado, mas outro binário
  // aparece antes no PATH e vence. Sem apontar isso, a pessoa reinstala o Node
  // várias vezes e o doctor continua reclamando da mesma versão velha.
  const sombreando = procurarNodeMaisNovo(maior)

  return {
    id: 'node',
    titulo: 'Node.js',
    estado: 'falha',
    detalhe: `v${process.versions.node} em ${process.execPath} (mínimo v${config.versaoNodeMinima})`,
    correcao:
      sombreando !== null
        ? `Já existe ${sombreando.versao} em ${sombreando.caminho}, mas ${process.execPath} ` +
          'aparece antes no PATH e vence. Remova ou renomeie o binário antigo — ' +
          `por exemplo: mv ${process.execPath} ${process.execPath}.antigo — e abra um shell novo.`
        : 'O agente roda TypeScript direto no Node e usa o módulo nativo node:sqlite. ' +
          `Instale o Node ${config.versaoNodeMinima} LTS: ` +
          `curl -fsSL https://deb.nodesource.com/setup_${config.versaoNodeMinima}.x | sudo -E bash - && ` +
          'sudo apt-get install -y nodejs',
  }
}

/** Procura, fora do PATH, um Node mais novo que o que está rodando. */
function procurarNodeMaisNovo(maiorAtual: number): { caminho: string; versao: string } | null {
  const candidatos = ['/usr/bin/node', '/usr/local/bin/node', '/opt/node/bin/node']

  for (const caminho of candidatos) {
    if (caminho === process.execPath) continue
    try {
      const versao = execFileSync(caminho, ['-v'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      const maior = Number(versao.replace(/^v/, '').split('.')[0] ?? 0)
      if (maior > maiorAtual && maior >= config.versaoNodeMinima) return { caminho, versao }
    } catch {
      // candidato não existe ou não executa: segue para o próximo
    }
  }
  return null
}

/**
 * O DevLab roda em qualquer Linux com Docker. O WSL2 é só o caminho de quem
 * está no Windows — não um requisito. O que é requisito é Linux, porque as
 * trilhas ensinam systemd, cgroups, firewall e captura de pacote de verdade.
 */
async function verificarSistema(): Promise<Verificacao> {
  if (os.platform() !== 'linux') {
    return {
      id: 'sistema',
      titulo: 'Sistema operacional',
      estado: 'falha',
      detalhe: `${os.platform()} — não suportado`,
      correcao:
        'O agente precisa rodar em Linux. No Windows, abra o Ubuntu do WSL2 e instale por lá. ' +
        'No macOS não há caminho suportado: o currículo depende de systemd e cgroups reais.',
    }
  }
  const versao = await ler('/proc/version')
  const ehWsl = versao !== null && /microsoft/i.test(versao)
  return {
    id: 'sistema',
    titulo: 'Sistema operacional',
    estado: 'ok',
    detalhe: ehWsl
      ? `Linux sobre WSL2 · ${os.release()}`
      : `Linux nativo · ${os.release()}`,
  }
}

async function verificarCgroupV2(): Promise<Verificacao> {
  const controladores = await ler('/sys/fs/cgroup/cgroup.controllers')
  const ok = controladores !== null
  return {
    id: 'cgroup',
    titulo: 'cgroup v2',
    estado: ok ? 'ok' : 'aviso',
    detalhe: ok
      ? 'montado — pré-requisito do systemd em container (Fase 2)'
      : 'não encontrado em /sys/fs/cgroup',
    ...(ok
      ? {}
      : {
          correcao:
            'A Fase 0 funciona sem isso, mas a trilha de servidores precisa de cgroup v2. ' +
            'No WSL2, garanta uma distro recente e Docker Engine atual.',
        }),
  }
}

async function verificarDocker(): Promise<Verificacao> {
  const d = await diagnosticarDaemon()
  if (d.ok) {
    return {
      id: 'docker',
      titulo: 'Docker Engine',
      estado: 'ok',
      detalhe: `v${d.versao} · API ${d.apiVersao} · ${d.sistema}`,
    }
  }
  return {
    id: 'docker',
    titulo: 'Docker Engine',
    estado: 'falha',
    detalhe: d.erro,
    correcao: d.sugestao,
  }
}

async function verificarImagens(): Promise<Verificacao> {
  try {
    const info = await docker().getImage(config.imagemPadrao).inspect()
    const tamanho = typeof info.Size === 'number' ? ` · ${(info.Size / GB).toFixed(2)} GB` : ''
    return {
      id: 'imagens',
      titulo: 'Imagens de lab',
      estado: 'ok',
      detalhe: `${config.imagemPadrao} presente${tamanho}`,
    }
  } catch {
    return {
      id: 'imagens',
      titulo: 'Imagens de lab',
      estado: 'falha',
      detalhe: `${config.imagemPadrao} não está no cache local`,
      correcao:
        'Construa uma vez (único passo que precisa de internet): npm run imagens',
    }
  }
}

async function verificarEspaco(): Promise<Verificacao> {
  try {
    const s = await fs.statfs('/var/lib')
    const livreGb = (s.bavail * s.bsize) / GB
    const suficiente = livreGb >= ESPACO_RECOMENDADO_GB
    return {
      id: 'espaco',
      titulo: 'Espaço em disco',
      estado: suficiente ? 'ok' : 'aviso',
      detalhe: `${livreGb.toFixed(1)} GB livres (recomendado ${ESPACO_RECOMENDADO_GB} GB para todas as trilhas)`,
      ...(suficiente
        ? {}
        : {
            correcao:
              'As imagens de VoIP (FreeSWITCH, Kamailio, Homer) são pesadas. ' +
              'Libere espaço ou construa só as imagens da trilha em uso.',
          }),
    }
  } catch (e) {
    return {
      id: 'espaco',
      titulo: 'Espaço em disco',
      estado: 'aviso',
      detalhe: e instanceof Error ? e.message : String(e),
    }
  }
}

async function verificarPorta(porta: number, papel: string): Promise<Verificacao> {
  const livre = await portaLivre(porta)
  return {
    id: `porta-${porta}`,
    titulo: `Porta ${porta} (${papel})`,
    estado: livre ? 'ok' : 'aviso',
    detalhe: livre ? 'livre' : 'ocupada',
    ...(livre
      ? {}
      : {
          correcao:
            porta === config.porta
              ? 'Outro processo está na porta do agente. Use DEVLAB_PORTA=<outra> ou libere a porta.'
              : 'Se o próprio DevLab já estiver rodando, isto é esperado.',
        }),
  }
}

async function verificarConteudo(): Promise<Verificacao> {
  const conteudo = await carregarConteudo(config.dirConteudo)
  if (conteudo.problemas.length > 0) {
    return {
      id: 'conteudo',
      titulo: 'Conteúdo declarativo',
      estado: 'falha',
      detalhe: `${conteudo.problemas.length} problema(s): ${conteudo.problemas.slice(0, 3).join(' | ')}`,
      correcao: 'Corrija os arquivos YAML em content/ e rode o doctor de novo.',
    }
  }
  return {
    id: 'conteudo',
    titulo: 'Conteúdo declarativo',
    estado: conteudo.licoes.length > 0 ? 'ok' : 'aviso',
    detalhe: `${conteudo.trilhas.length} trilha(s), ${conteudo.licoes.length} lição(ões), ${conteudo.catalogo.length} erro(s) no catálogo`,
  }
}

/**
 * A IA é opcional por princípio: aqui ela nunca vira 'falha'.
 * O pior caso é 'aviso' — o DevLab inteiro funciona sem ela.
 */
async function verificarIa(): Promise<Verificacao> {
  if (!config.ia.ligada) {
    return {
      id: 'ia',
      titulo: 'IA local (opcional)',
      estado: 'ok',
      detalhe: 'desligada — o núcleo não depende dela',
      correcao:
        `Para ligar: DEVLAB_IA=1 npm run dev (modelo ${config.ia.modelo} via Ollama, ` +
        'rodando na sua máquina — nenhum dado sai daqui).',
    }
  }

  const d = await new ProvedorOllama().diagnosticar()
  if (d.disponivel) {
    return {
      id: 'ia',
      titulo: 'IA local (opcional)',
      estado: 'ok',
      detalhe: `ligada · ${d.modelo} via ${d.provedor} em ${d.url}`,
    }
  }

  return {
    id: 'ia',
    titulo: 'IA local (opcional)',
    estado: 'aviso',
    detalhe: `ligada, mas indisponível: ${d.erro ?? 'motivo desconhecido'}`,
    ...(d.sugestao !== undefined ? { correcao: d.sugestao } : {}),
  }
}

function portaLivre(porta: number): Promise<boolean> {
  return new Promise((resolver) => {
    const servidor = net.createServer()
    servidor.once('error', () => resolver(false))
    servidor.once('listening', () => {
      servidor.close(() => resolver(true))
    })
    servidor.listen(porta, config.host)
  })
}

async function ler(caminho: string): Promise<string | null> {
  try {
    return await fs.readFile(caminho, 'utf8')
  } catch {
    return null
  }
}
